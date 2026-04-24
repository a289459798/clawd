import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ConversationComposer } from "./components/ConversationComposer";
import { ConversationDetail } from "./components/ConversationDetail";
import { ConversationList } from "./components/ConversationList";
import { getConversationDetailState } from "./lib/conversationDetailState";
import type { Conversation, ConversationRuntime, MessagePart, PreviewMessage } from "./types/conversation";
import type { RealtimeGatewayEvent } from "./realtime";
import "./App.css";

type NavKey = "conversations" | "skills" | "connections";
type AgentStatus = "working" | "completed" | "idle";

type Agent = {
  id: string;
  name: string;
  color: string;
  status: AgentStatus;
  model: string;
  mdFile: string;
  configPath: string;
  summary: string;
  conversations: Conversation[];
};

type Skill = {
  id: string;
  name: string;
  summary: string;
  location: string;
  enabled: boolean;
};

type ChannelConnection = {
  id: string;
  name: string;
  status: "connected" | "warning" | "disabled";
  detail: string;
  config: string;
  activity: string;
};

type SnapshotSession = {
  id: string;
  agent_id: string;
  key: string;
  title: string;
  updated_at?: number;
  channel?: string;
  session_file?: string;
  last_message?: string;
  last_role?: string;
  latest_event_role?: string;
  latest_event_type?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  total_tokens?: number;
  total_tokens_fresh?: boolean;
  estimated_cost_usd?: number;
  preview_messages: Array<{ role?: string; text: string; parts?: MessagePart[]; model?: string; provider?: string; api?: string; timestamp?: number; input_tokens?: number; output_tokens?: number; cache_read_tokens?: number; cache_write_tokens?: number }>;
};

type OpenClawSnapshot = {
  agents: Array<{ id: string; name: string; workspace?: string; model?: string; agent_dir?: string }>;
  sessions: SnapshotSession[];
  connections: Array<{ id: string; name: string; enabled: boolean }>;
  skills: Array<{ id: string; name: string; location: string }>;
};

type GatewayStatus = {
  connected: boolean;
  statusText: string;
  error?: string | null;
};

type ClawxBootstrapStatus = {
  openclawInstalled: boolean;
  openclawPath?: string | null;
  configExists: boolean;
  configPath: string;
  bindingConfigured: boolean;
  allowedOrigins: string[];
  recommendedOrigin: string;
  gatewayPort?: number | null;
  bindingWrites: string[];
};

type GatewayHistoryResult = {
  messages: GatewayMessage[];
};

type GatewayPart =
  | { type: "text"; text: string }
  | { type: "toolcall"; name?: string; arguments?: unknown }
  | { type: "toolresult"; name?: string; text?: string }
  | { type: "image" | "input_image" | "image_url"; data?: string; url?: string; mimeType?: string; mime_type?: string; text?: string; alt?: string; image_url?: { url?: string } };

type GatewayUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
};

type GatewayMessage = {
  role?: string;
  content?: GatewayPart[] | string;
  text?: string;
  timestamp?: number;
  model?: string;
  provider?: string;
  api?: string;
  usage?: GatewayUsage;
};

type GatewayChatEvent = {
  type?: string;
  state?: "delta" | "final" | "aborted" | "error";
  sessionKey?: string;
  runId?: string;
  message?: GatewayMessage;
  errorMessage?: string;
};

type ComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  previewUrl?: string;
};

type GatewayCreateSessionResult = {
  key?: string;
  sessionId?: string;
  ok?: boolean;
};

const agentsSeed: Agent[] = [];
const fallbackSkills: Skill[] = [];
const fallbackConnections: ChannelConnection[] = [];

const statusLabel: Record<AgentStatus, string> = {
  working: "进行中",
  completed: "已完成",
  idle: "空闲中",
};

const connectionLabel: Record<ChannelConnection["status"], string> = {
  connected: "已连接",
  warning: "需检查",
  disabled: "未启用",
};

const formatTokenCount = (value?: number) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  if (value === 0) {
    return "0";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  }
  return String(value);
};

/** Extract sender label and time from message text */
function parseSenderMeta(text: string): { label?: string; time?: string; cleanText: string } {
  let label: string | undefined;
  let time: string | undefined;
  let cleanText = text;

  const timeRegex = /\[([A-Za-z]+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s*GMT[+-]\d+)\]\s*\n?/;
  const timeMatch = cleanText.match(timeRegex);
  if (timeMatch) {
    const raw = timeMatch[1];
    time = raw.replace(/\s*GMT[+-]\d+/, "").replace(/^([A-Za-z]+\s+)(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})$/, "$2");
    cleanText = cleanText.replace(timeRegex, "");
  }

  const metaRegex = /Sender\s+\(untrusted\s+metadata\):\s*\n\s*```json\n([\s\S]*?)\n\s*```\n?/;
  const match = cleanText.match(metaRegex);
  if (match) {
    try {
      const meta = JSON.parse(match[1]);
      label = meta.label ?? meta.id ?? undefined;
      cleanText = cleanText.replace(metaRegex, "").trim();
    } catch {
      cleanText = cleanText.trim();
    }
    return { label, time, cleanText };
  }

  const inlineRegex = /Sender\s+\(untrusted\s+metadata\):\s*\n\s*\{[\s\S]*?\n\s*\}\n?/;
  const inlineMatch = cleanText.match(inlineRegex);
  if (inlineMatch) {
    try {
      const meta = JSON.parse(inlineMatch[0].replace(/^Sender\s+\(untrusted\s+metadata\):\s*\n\s*/, ""));
      label = meta.label ?? meta.id ?? undefined;
      cleanText = cleanText.replace(inlineRegex, "").trim();
    } catch {
      cleanText = cleanText.trim();
    }
    return { label, time, cleanText };
  }

  cleanText = cleanText.trim();
  return { label, time, cleanText };
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [code]);

  return (
    <div className="code-block-shell">
      <div className="code-block-toolbar">
        <span className="code-block-language">{language ?? "text"}</span>
        <button className="code-block-copy-button" type="button" onClick={() => void onCopy()}>
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="tool-entry-body code terminal-block">{code}</pre>
    </div>
  );
}

function MarkdownBlock({ content, className }: { content: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { className, children, ...rest } = props;
            const match = String(className ?? "").match(/language-([\w-]+)/);
            const language = match?.[1];
            const value = String(children).replace(/\n$/, "");
            if (!language) {
              return <code className="inline-code" {...rest}>{children}</code>;
            }
            return <CodeBlock code={value} language={language} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function normalizeImageSrc(data: string, mimeType?: string) {
  if (data.startsWith("data:") || data.startsWith("http://") || data.startsWith("https://") || data.startsWith("/") || data.startsWith("file://")) {
    return data;
  }
  const mime = mimeType && mimeType.length > 0 ? mimeType : "image/png";
  return `data:${mime};base64,${data}`;
}

function MessageBubbleWithCopy({
  text,
  imageVariant,
}: {
  text: string;
  imageVariant: "user" | "assistant" | "tool";
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  const isAssistant = imageVariant !== "user";

  return (
    <div className={`message-bubble ${imageVariant === "user" ? "user" : "assistant"}`}>
      {isAssistant ? (
        <div className="message-bubble-content">
          <MarkdownBlock content={text} className="markdown-body" />
          <button
            className={`message-copy-button ${copied ? "copied" : ""}`}
            type="button"
            onClick={handleCopy}
            title={copied ? "已复制" : "复制内容"}
          >
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        </div>
      ) : (
        <MarkdownBlock content={text} className="markdown-body" />
      )}
    </div>
  );
}

function StructuredMessageContent({
  parts,
  conversationId,
  onOpenImage,
  imageVariant = "assistant",
}: {
  parts: MessagePart[];
  conversationId: string;
  onOpenImage: (src: string) => void;
  imageVariant?: "user" | "assistant" | "tool";
}) {
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const textBlocks: string[] = [];
  const imageBlocks: Array<Extract<MessagePart, { kind: "image" }>> = [];
  const toolCalls: Array<{ tool: string; args?: string }> = [];

  for (const part of parts) {
    if (part.kind === "tool_call") {
      toolCalls.push({ tool: part.tool, args: part.args });
      continue;
    }
    if (part.kind === "tool_result") {
      continue;
    }
    if (part.kind === "image") {
      imageBlocks.push(part);
      continue;
    }
    textBlocks.push(part.text);
  }

  return (
    <>
      {toolCalls.length > 0 ? (
        <div className="tool-call-box" key={`${conversationId}-tools`}>
          <button className="tool-call-summary" type="button" onClick={() => setToolsExpanded((v) => !v)}>
            <span className="tool-call-summary-label">已执行 {toolCalls.length} 项操作</span>
            <span className="tool-call-summary-items">{Array.from(new Set(toolCalls.map((item) => item.tool))).slice(0, 3).join(" · ")}</span>
            <span className="tool-call-summary-toggle">{toolsExpanded ? "收起" : "展开"}</span>
          </button>
          {toolsExpanded ? (
            <div className="tool-call-detail-list">
              {toolCalls.map((item, index) => (
                <div className="tool-call-detail" key={`${conversationId}-tool-${index}`}>
                  <div className="tool-call-detail-name">{item.tool}</div>
                  {item.args ? <pre className="tool-call-detail-args">{item.args}</pre> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {textBlocks.map((text, index) => (
        <MessageBubbleWithCopy
          key={`${conversationId}-text-${index}`}
          text={text}
          imageVariant={imageVariant}
        />
      ))}

      {imageBlocks.map((part, index) => {
        const src = normalizeImageSrc(part.data, part.mime_type);
        return (
          <button className={`message-image-card ${imageVariant}`} key={`${conversationId}-image-${index}`} type="button" onClick={() => onOpenImage(src)}>
            <img className="message-image" src={src} alt={part.alt ?? "图片内容"} />
            <span className="message-image-badge">{imageVariant === "user" ? "用户图片" : "图片"}</span>
          </button>
        );
      })}
    </>
  );
}

function ConversationMessageList({
  messages,
  conversationId,
  onOpenImage,
}: {
  messages: PreviewMessage[];
  conversationId: string;
  onOpenImage: (src: string) => void;
}) {
  const { rows, lastAssistantMessage } = useMemo(() => {
    const normalizedMessages = messages
      .filter((message) => {
        const role = message.role?.toLowerCase();
        if (role === "user" || role === "toolresult" || role === "tool_result") return false;
        const text = (message.text ?? "").trim().toLowerCase();
        if (text.startsWith("tool_result:") || text.startsWith("toolresult:")) return false;
        return true;
      })
      .map((message) => ({
        ...message,
        parts: (message.parts ?? []).filter((part) => part.kind !== "tool_result"),
      }));

    const rows: Array<
      | { kind: "message"; message: PreviewMessage; index: number }
      | { kind: "tool_group"; items: Array<{ message: PreviewMessage; index: number }> }
    > = [];

    let pendingToolMessages: Array<{ message: PreviewMessage; index: number }> = [];
    const isToolOnlyMessage = (message: PreviewMessage) => {
      const parts = message.parts ?? [];
      // A message is considered "tool-only" if it contains tool_calls
      // (even if it also has text content, we extract tool_calls for display)
      return parts.some((part) => part.kind === "tool_call");
    };
    const flushToolMessages = () => {
      if (pendingToolMessages.length > 0) {
        rows.push({ kind: "tool_group", items: pendingToolMessages });
        pendingToolMessages = [];
      }
    };

    normalizedMessages.forEach((message, index) => {
      if (isToolOnlyMessage(message)) {
        pendingToolMessages.push({ message, index });
        return;
      }
      flushToolMessages();
      rows.push({ kind: "message", message, index });
    });
    flushToolMessages();

    // Find the last assistant message that has actual content (not just tool calls)
    // and contains token data for display
    const lastAssistantMessage = [...normalizedMessages]
      .reverse()
      .find((m) => {
        const role = m.role?.toLowerCase();
        if (role !== "assistant") return false;
        // Skip messages that only contain tool calls (no text content)
        const parts = m.parts ?? [];
        const hasTextContent = parts.some((p) => p.kind === "text" && p.text?.trim());
        const hasImageContent = parts.some((p) => p.kind === "image");
        return hasTextContent || hasImageContent || (!parts.length && m.text?.trim());
      });

    return { rows, lastAssistantMessage };
  }, [messages]);

  return (
    <>
      {rows.map((row, index) => {
        if (row.kind === "tool_group") {
          const mergedParts = row.items.flatMap((item) => item.message.parts ?? []);
          return (
            <div className="message-stack tool-stack" key={`${conversationId}-tool-group-${index}`}>
              <StructuredMessageContent
                parts={mergedParts}
                conversationId={`${conversationId}-tool-group-${index}`}
                onOpenImage={onOpenImage}
                imageVariant="tool"
              />
            </div>
          );
        }

        const { message } = row;
        const parts = message.parts?.length ? message.parts : [{ kind: "text", text: message.text } as MessagePart];
        return (
          <div className="message-stack" key={`${conversationId}-message-${index}`}>
            <StructuredMessageContent
              parts={parts}
              conversationId={`${conversationId}-${index}`}
              onOpenImage={onOpenImage}
              imageVariant={message.role?.toLowerCase() === "user" ? "user" : "assistant"}
            />
          </div>
        );
      })}

      {lastAssistantMessage?.model ? (
        <div className="conversation-model-footer" key={`${conversationId}-model-footer`}>
          <span className="conversation-model-name">{lastAssistantMessage.model}</span>
          <span className="conversation-model-divider">·</span>
          <span className="conversation-model-tokens">
            <span className="token-item">↑{formatTokenCount(lastAssistantMessage.output_tokens)}</span>
            <span className="token-item">↓{formatTokenCount(lastAssistantMessage.input_tokens)}</span>
            <span className="token-item">R{formatTokenCount(lastAssistantMessage.cache_read_tokens)}</span>
          </span>
        </div>
      ) : null}
    </>
  );
}

/** AI message renderer that separates text, tool calls, and tool results */
const COMPLETED_RECENT_WINDOW_MS = 10 * 60 * 1000;

const deriveConversationStatus = (runtime?: ConversationRuntime) => {
  const now = Date.now();
  if (runtime?.activeRunId) {
    return "working" as const;
  }
  if (runtime?.lastTerminalAt && now - runtime.lastTerminalAt <= COMPLETED_RECENT_WINDOW_MS) {
    return "completed" as const;
  }
  return "idle" as const;
};

const patchConversation = (conversation: Conversation, updater: (conversation: Conversation) => Conversation): Conversation => {
  const next = updater(conversation);
  return {
    ...next,
    status: deriveConversationStatus(next.runtime),
  };
};

function extractUsageFromGatewayMessage(message?: GatewayMessage | null) {
  return {
    input_tokens: message?.usage?.input,
    output_tokens: message?.usage?.output,
    cache_read_tokens: message?.usage?.cacheRead,
    cache_write_tokens: message?.usage?.cacheWrite,
  };
}

function stripInboundWrapperText(text: string) {
  return text
    .replace(/Sender\s+\(untrusted\s+metadata\):\s*\n\s*```json\n[\s\S]*?\n\s*```\n?/g, "")
    .replace(/Sender\s+\(untrusted\s+metadata\):\s*\n\s*\{[\s\S]*?\n\s*\}\n?/g, "")
    .replace(/^\[[A-Za-z]+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s*GMT[+-]\d+\]\s*/gm, "")
    .trim();
}

function extractTextFromGatewayMessage(message?: GatewayMessage | null) {
  if (!message) return "";
  if (typeof message.text === "string") {
    return stripInboundWrapperText(message.text);
  }
  if (typeof message.content === "string") {
    return stripInboundWrapperText(message.content);
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (part.type === "text") return part.text ?? "";
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

function mapGatewayContentToParts(message?: GatewayMessage | null): MessagePart[] {
  if (!message) return [];
  if (typeof message.content === "string") {
    const cleaned = stripInboundWrapperText(message.content);
    return cleaned.trim() ? [{ kind: "text", text: cleaned }] : [];
  }
  if (Array.isArray(message.content)) {
    return message.content.flatMap<MessagePart>((part) => {
      if (part.type === "text") {
        const cleaned = stripInboundWrapperText(part.text ?? "");
        return cleaned.trim() ? [{ kind: "text", text: cleaned }] : [];
      }
      if (part.type === "toolcall") {
        return [{ kind: "tool_call", tool: part.name ?? "tool", args: typeof part.arguments === "string" ? part.arguments : JSON.stringify(part.arguments ?? {}, null, 2) }];
      }
      if (part.type === "toolresult") {
        return [];
      }
      if (part.type === "image" || part.type === "input_image" || part.type === "image_url") {
        const src = part.data ?? part.url ?? part.image_url?.url;
        return src ? [{ kind: "image", data: src, mime_type: part.mimeType ?? part.mime_type, alt: part.text ?? part.alt }] : [];
      }
      return [];
    });
  }
  if (typeof message.text === "string") {
    const cleaned = stripInboundWrapperText(message.text);
    return cleaned.trim() ? [{ kind: "text", text: cleaned }] : [];
  }
  return [];
}

const MODEL_OPTIONS = [
  { value: "openai-codex/gpt-5.4", label: "GPT-5.4 (Codex)" },
  { value: "openai/gpt-5.4", label: "GPT-5.4" },
  { value: "openai/gpt-4.1", label: "GPT-4.1" },
  { value: "bailian/qwen3.6-plus", label: "Qwen3.6-Plus" },
  { value: "bailian/qwen3-coder-plus", label: "Qwen3-Coder-Plus" },
  { value: "moonshot/kimi-k2-thinking", label: "Kimi-K2-Thinking" },
  { value: "moonshot/kimi-k2-turbo-preview", label: "Kimi-K2-Turbo" },
];

function buildAgentsFromSnapshot(
  snapshot: OpenClawSnapshot,
  currentAgentSnapshots: Agent[],
  options?: { preserveExistingConversations?: boolean; activeConversationId?: string | null },
): Agent[] {
  const colors = ["#52f2c5", "#7aa2ff", "#f08b7d", "#c08bff", "#f3bf63"];
  return snapshot.agents.map((agent, index) => {
    const existing = currentAgentSnapshots.find((item) => item.id === agent.id);
    const realSessions = snapshot.sessions
      .filter((session) => session.agent_id === agent.id)
      .slice(0, 8)
      .map((session, sessionIndex) => {
        const latestRole = (session.last_role ?? session.preview_messages[session.preview_messages.length - 1]?.role)?.toLowerCase();
        const latestAssistantMessage = [...session.preview_messages]
          .reverse()
          .find((message) => (message.role?.toLowerCase() ?? "") === "assistant");

        const existingConversation = existing?.conversations.find((item) => item.id === session.key);
        const runtime: ConversationRuntime = existingConversation?.runtime ?? {
          activeRunId: undefined,
          activeStartedAt: undefined,
          lastEventAt: session.updated_at,
          lastTerminalAt: latestRole === "assistant" ? session.updated_at : undefined,
          lastTerminalReason: latestRole === "assistant" ? "completed" : undefined,
        };
        // Merge previewMessages: use session messages as base, but preserve token data from existing messages
        const existingPreviewMessages = existingConversation?.previewMessages;
        const sessionMessages = session.preview_messages || [];
        // Create a map of existing messages by index for quick lookup
        const existingMessagesMap = new Map<number, PreviewMessage>();
        if (existingPreviewMessages) {
          existingPreviewMessages.forEach((msg, idx) => existingMessagesMap.set(idx, msg));
        }
        // Use session messages directly - they come from the backend snapshot
        // Note: When entering a conversation, openConversationDetail will fetch
        // full message history via gateway_chat_history and update previewMessages
        const mergedPreviewMessages = sessionMessages as PreviewMessage[];
        return {
          id: session.key,
          title: session.title,
          status: deriveConversationStatus(runtime),
          lastMessage:
            latestAssistantMessage?.text ??
            session.last_message ??
            "暂无回复内容",
          previewMessages: mergedPreviewMessages,
          lastRole: latestRole,
          latestEventRole: session.latest_event_role?.toLowerCase(),
          latestEventType: session.latest_event_type?.toLowerCase(),
          lastTime: session.updated_at ? new Date(session.updated_at).toLocaleString("zh-CN") : "未知时间",
          updatedAt: session.updated_at,
          tokens: formatTokenCount(session.total_tokens),
          inputTokens: session.input_tokens,
          outputTokens: session.output_tokens,
          cacheReadTokens: session.cache_read_tokens,
          cacheWriteTokens: session.cache_write_tokens,
          totalTokens: session.total_tokens,
          model: agent.model ?? existing?.model ?? "未配置",
          workspace: agent.workspace ?? "/Users/zhangzy/clawd",
          visible: sessionIndex < 3,
          pinned: sessionIndex === 0,
          runtime,
        };
      });

    return {
      id: agent.id,
      name: agent.name,
      color: existing?.color ?? colors[index % colors.length],
      status: existing?.status ?? "idle",
      model: agent.model ?? existing?.model ?? "未配置",
      mdFile: existing?.mdFile ?? `${agent.id}.md`,
      configPath: agent.agent_dir ?? existing?.configPath ?? `agents.list.${index}`,
      summary: existing?.summary ?? "来自本地 OpenClaw 配置。",
      // If preserveExistingConversations is true, merge realSessions with existing conversations
      // Keep existing conversations that are not in the snapshot (active conversations)
      conversations: (() => {
        if (options?.preserveExistingConversations && existing?.conversations) {
          const sessionIds = new Set(realSessions.map((s) => s.id));
          const existingNotInSnapshot = existing.conversations.filter((c) => !sessionIds.has(c.id));
          const merged = [...realSessions, ...existingNotInSnapshot];
          return merged.length > 0 ? merged : existing?.conversations ?? [];
        }
        return realSessions.length > 0 ? realSessions : existing?.conversations ?? [];
      })(),
    } as Agent;
  });
}

function resolveAgentDefaultModel(agents: Agent[], agentId: string) {
  const agent = agents.find((item) => item.id === agentId);
  if (!agent) {
    return MODEL_OPTIONS[0]?.value ?? "";
  }
  if (agent.model && agent.model !== "未配置") {
    return agent.model;
  }
  return MODEL_OPTIONS[0]?.value ?? "";
}

function App() {
  const [bootstrapStatus, setBootstrapStatus] = useState<ClawxBootstrapStatus | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bindingInProgress, setBindingInProgress] = useState(false);
  const [bootstrapStep, setBootstrapStep] = useState<"detect" | "install" | "bind" | "connect_test" | "ready">("detect");
  const [bootstrapConnectError, setBootstrapConnectError] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState<NavKey>("conversations");
  const [agents, setAgents] = useState(agentsSeed);
  const [expandedConversationId, setExpandedConversationId] = useState("");
  const [showResourceSidebar, setShowResourceSidebar] = useState(true);
  const [skills, setSkills] = useState<Skill[]>(fallbackSkills);
  const [connections, setConnections] = useState<ChannelConnection[]>(fallbackConnections);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const [composerValue, setComposerValue] = useState("");
  const [composerModel, setComposerModel] = useState(MODEL_OPTIONS[0]?.value ?? "");
  const [composerThinking, setComposerThinking] = useState("off");
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [gatewayStatusText, setGatewayStatusText] = useState("Gateway 连接中...");
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const [userExpanded, setUserExpanded] = useState(false);
  const aiResponseScrollRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const gatewayEventUnlistenRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    activeRunIdRef.current = activeRunId;
  }, [activeRunId]);

  const loadBootstrapStatus = useCallback(async () => {
    setBootstrapLoading(true);
    setBootstrapError(null);
    try {
      const status = await invoke<ClawxBootstrapStatus>("get_clawx_bootstrap_status");
      setBootstrapStatus(status);
      setBootstrapStep(!status.openclawInstalled ? "install" : status.bindingConfigured ? "ready" : "bind");
    } catch (error) {
      console.error("Failed to load clawx bootstrap status", error);
      setBootstrapError(error instanceof Error ? error.message : "读取 OpenClaw 状态失败");
    } finally {
      setBootstrapLoading(false);
    }
  }, []);

  const bindOpenClaw = useCallback(async () => {
    setBindingInProgress(true);
    setBootstrapError(null);
    setBootstrapConnectError(null);
    try {
      const status = await invoke<ClawxBootstrapStatus>("ensure_clawx_binding");
      setBootstrapStatus(status);
      setBootstrapStep(status.bindingConfigured ? "connect_test" : "bind");
    } catch (error) {
      console.error("Failed to bind OpenClaw config", error);
      setBootstrapError(error instanceof Error ? error.message : "写入 OpenClaw 配置失败");
    } finally {
      setBindingInProgress(false);
    }
  }, []);

  useEffect(() => {
    void loadBootstrapStatus();
  }, [loadBootstrapStatus]);

  useEffect(() => {
    if (!bootstrapStatus?.openclawInstalled || !bootstrapStatus.bindingConfigured) {
      return;
    }

    if (bootstrapStep === "connect_test") {
      let cancelled = false;
      void (async () => {
        setBootstrapConnectError(null);
        try {
          await invoke("gateway_connect");
          if (!cancelled) {
            setBootstrapStep("ready");
          }
        } catch (error) {
          console.error("Gateway connect test failed", error);
          if (!cancelled) {
            setBootstrapConnectError(error instanceof Error ? error.message : "Gateway 连接测试失败");
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    if (bootstrapStep !== "ready") {
      return;
    }

    let cancelled = false;

    // Ensure gateway connection on app startup (binding may already be configured).
    // gateway_connect returns "already connected" if previously established, so this is safe.
    void (async () => {
      try {
        await invoke("gateway_connect");
      } catch {
        // Ignore errors here; connection status will be reported by refreshGatewayStatus.
      }
    })();

    const loadSnapshot = async () => {
      try {
        const currentAgentSnapshots = agents;
        const snapshot = await invoke<OpenClawSnapshot>("load_openclaw_snapshot");
        if (cancelled) {
          return;
        }

        // Skip updating if there's an active run in progress to avoid overwriting runtime state
        const hasActiveRun = currentAgentSnapshots.some((agent) =>
          agent.conversations.some((conv) => conv.runtime?.activeRunId),
        );
        if (hasActiveRun) {
          return;
        }

        setAgents(buildAgentsFromSnapshot(snapshot, currentAgentSnapshots, { preserveExistingConversations: true }));

        setSkills(
          snapshot.skills.map((skill) => ({
            id: skill.id,
            name: skill.name,
            summary: "来自本地 OpenClaw skill 目录。",
            location: skill.location,
            enabled: true,
          })),
        );

        setConnections(
          snapshot.connections.map((connection) => ({
            id: connection.id,
            name: connection.name,
            status: connection.enabled ? "connected" : "disabled",
            detail: connection.enabled ? "已从本地 OpenClaw 配置读取" : "当前未启用",
            config: `channels.${connection.id}`,
            activity: connection.enabled ? "配置已启用" : "配置关闭",
          })),
        );
      } catch (error) {
        console.error("Failed to load OpenClaw snapshot", error);
      }
    };

    // Load snapshot only once on startup
    // Polling removed to avoid overwriting frontend state (token data, streaming messages, tools)
    void loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, [bootstrapStatus?.bindingConfigured, bootstrapStatus?.openclawInstalled, bootstrapStep]);

  useEffect(() => {
    if (!bootstrapStatus?.openclawInstalled || !bootstrapStatus.bindingConfigured || bootstrapStep !== "ready") {
      return;
    }
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      try {
        const subscriptionId = await invoke<number>("subscribe_gateway_realtime");
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen<RealtimeGatewayEvent>(`gateway-realtime://${subscriptionId}`, (event) => {
          const payload = event.payload;
          if (!payload || payload.type !== "session_patch") {
            return;
          }

          setAgents((current) =>
            current.map((agent) => ({
              ...agent,
              conversations: agent.conversations.map((conversation) => {
                if (conversation.id !== payload.session.key) {
                  return conversation;
                }
                const nextUpdatedAt = payload.session.updatedAt ?? conversation.updatedAt;
                const nextLastRole = payload.session.lastRole?.toLowerCase() ?? conversation.lastRole;
                const nextLatestEventType = payload.session.latestEventType?.toLowerCase() ?? conversation.latestEventType;
                const nextTotalTokens = payload.session.totalTokens ?? conversation.totalTokens;
                return patchConversation(conversation, (currentConversation) => ({
                  ...currentConversation,
                  lastMessage: payload.session.lastMessage ?? currentConversation.lastMessage,
                  lastRole: nextLastRole,
                  latestEventRole: payload.session.latestEventRole?.toLowerCase() ?? currentConversation.latestEventRole,
                  latestEventType: nextLatestEventType,
                  updatedAt: nextUpdatedAt,
                  lastTime: nextUpdatedAt ? new Date(nextUpdatedAt).toLocaleString("zh-CN") : currentConversation.lastTime,
                  inputTokens: payload.session.inputTokens ?? currentConversation.inputTokens,
                  outputTokens: payload.session.outputTokens ?? currentConversation.outputTokens,
                  cacheReadTokens: payload.session.cacheReadTokens ?? currentConversation.cacheReadTokens,
                  cacheWriteTokens: payload.session.cacheWriteTokens ?? currentConversation.cacheWriteTokens,
                  totalTokens: nextTotalTokens,
                  tokens: formatTokenCount(nextTotalTokens),
                  model: payload.session.model ?? currentConversation.model,
                  previewMessages: currentConversation.previewMessages,
                  // Preserve existing runtime state from frontend; session_patch doesn't include runtime info
                  runtime: currentConversation.runtime ?? {
                    activeRunId: undefined,
                    activeStartedAt: undefined,
                    lastEventAt: nextUpdatedAt,
                    lastTerminalAt: nextLastRole === "assistant" ? nextUpdatedAt : undefined,
                    lastTerminalReason: nextLastRole === "assistant" ? "completed" : undefined,
                  },
                }));
              }),
            })),
          );
        });

        cleanup = () => {
          unlisten();
          void invoke("unsubscribe_gateway_realtime", { subscriptionId });
        };

        if (cancelled) {
          cleanup();
        }
      } catch (error) {
        console.error("Failed to subscribe realtime events", error);
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [bootstrapStatus?.bindingConfigured, bootstrapStatus?.openclawInstalled, bootstrapStep]);

  const refreshGatewayStatus = useCallback(async () => {
    try {
      const status = await invoke<GatewayStatus>("gateway_status");
      setGatewayConnected(status.connected);
      setGatewayStatusText(status.statusText || (status.connected ? "Gateway 已连接" : "Gateway 未连接"));
      setGatewayError(status.error ?? null);
      if (!status.connected) {
        const disconnectedAt = Date.now();
        setAgents((current) => current.map((agent) => ({
          ...agent,
          conversations: agent.conversations.map((conversation) => {
            if (!conversation.runtime?.activeRunId) return conversation;
            return patchConversation(conversation, (currentConversation) => ({
              ...currentConversation,
              runtime: {
                ...currentConversation.runtime,
                activeRunId: undefined,
                activeStartedAt: undefined,
                lastEventAt: disconnectedAt,
                lastTerminalAt: disconnectedAt,
                lastTerminalReason: "interrupted",
              },
            }));
          }),
        })));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const disconnectedAt = Date.now();
      setGatewayConnected(false);
      setGatewayStatusText(`Gateway 状态获取失败: ${message}`);
      setGatewayError(message);
      setAgents((current) => current.map((agent) => ({
        ...agent,
        conversations: agent.conversations.map((conversation) => {
          if (!conversation.runtime?.activeRunId) return conversation;
          return patchConversation(conversation, (currentConversation) => ({
            ...currentConversation,
            runtime: {
              ...currentConversation.runtime,
              activeRunId: undefined,
              activeStartedAt: undefined,
              lastEventAt: disconnectedAt,
              lastTerminalAt: disconnectedAt,
              lastTerminalReason: "interrupted",
            },
          }));
        }),
      })));
    }
  }, []);

  const openLocalOpenClaw = async () => {
    try {
      const dashboardUrl = await invoke<string>("resolve_dashboard_url");
      await openUrl(dashboardUrl);
    } catch (error) {
      console.error("Failed to open OpenClaw dashboard", error);
    }
  };

  useEffect(() => {
    if (bootstrapStep !== "ready") {
      return;
    }
    let mounted = true;
    let dispose: (() => void) | undefined;

    void (async () => {
      await refreshGatewayStatus();
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen<GatewayChatEvent>("clawx://gateway-chat", (event) => {
          const chat = event.payload;
          if (!mounted || !chat?.sessionKey) {
            return;
          }

          const eventTimestamp = chat.message?.timestamp ?? Date.now();
          const eventLastTime = new Date(eventTimestamp).toLocaleString("zh-CN");
          const isCurrentConversation = activeConversationIdRef.current === chat.sessionKey;
          const isCurrentRun = !chat.runId || !activeRunIdRef.current || chat.runId === activeRunIdRef.current;

          if (chat.state === "delta") {
            const deltaText = extractTextFromGatewayMessage(chat.message);
            const deltaParts = mapGatewayContentToParts(chat.message);
            if (!deltaText && deltaParts.length === 0) return;
            setAgents((current) => current.map((agent) => ({
              ...agent,
              conversations: agent.conversations.map((conversation) => {
                if (conversation.id !== chat.sessionKey) return conversation;
                return patchConversation(conversation, (currentConversation) => {
                  const nextMessages = [...(currentConversation.previewMessages ?? [])];
                  const streamingMarker = chat.runId ? `__streaming__${chat.runId}__` : "__streaming__";
                  const lastIndex = nextMessages.length - 1;
                  const last = nextMessages[lastIndex];
                  if (last?.role === "assistant" && last.text.startsWith(streamingMarker)) {
                    const usage = extractUsageFromGatewayMessage(chat.message);
                    nextMessages[lastIndex] = {
                      ...last,
                      text: `${streamingMarker}${deltaText || last.text.replace(streamingMarker, "")}`,
                      parts: deltaParts.length > 0 ? deltaParts : [{ kind: "text", text: deltaText }],
                      model: chat.message?.model ?? last.model,
                      provider: chat.message?.provider ?? last.provider,
                      api: chat.message?.api ?? last.api,
                      timestamp: eventTimestamp,
                      input_tokens: usage.input_tokens ?? last.input_tokens,
                      output_tokens: usage.output_tokens ?? last.output_tokens,
                      cache_read_tokens: usage.cache_read_tokens ?? last.cache_read_tokens,
                      cache_write_tokens: usage.cache_write_tokens ?? last.cache_write_tokens,
                    };
                  } else {
                    if (deltaParts.length > 0 || deltaText) {
                      nextMessages.push({ role: "assistant", text: `${streamingMarker}${deltaText}`, parts: deltaParts.length > 0 ? deltaParts : [{ kind: "text", text: deltaText }], model: chat.message?.model, provider: chat.message?.provider, api: chat.message?.api, timestamp: eventTimestamp, ...extractUsageFromGatewayMessage(chat.message) });
                    }
                  }
                  return {
                    ...currentConversation,
                    lastRole: "assistant",
                    latestEventType: "assistant_stream",
                    lastMessage: deltaText || currentConversation.lastMessage,
                    previewMessages: nextMessages,
                    updatedAt: eventTimestamp,
                    lastTime: eventLastTime,
                    runtime: {
                      ...currentConversation.runtime,
                      activeRunId: chat.runId ?? currentConversation.runtime?.activeRunId,
                      activeStartedAt: currentConversation.runtime?.activeStartedAt ?? eventTimestamp,
                      lastEventAt: eventTimestamp,
                    },
                  };
                });
              }),
            })));
            if (isCurrentConversation && isCurrentRun) {
              setSending(true);
            }
            return;
          }

          if (chat.state === "final" || chat.state === "aborted") {
            const finalText = extractTextFromGatewayMessage(chat.message);
            const finalParts = mapGatewayContentToParts(chat.message);
            const terminalEventType = chat.state === "aborted" ? "aborted" : "turn_completed";
            if (isCurrentConversation && isCurrentRun) {
              setActiveRunId(null);
              setSending(false);
            }
            setAgents((current) => current.map((agent) => ({
              ...agent,
              conversations: agent.conversations.map((conversation) => {
                if (conversation.id !== chat.sessionKey) return conversation;
                return patchConversation(conversation, (currentConversation) => {
                  const nextMessages = [...(currentConversation.previewMessages ?? [])];
                  const streamingMarker = chat.runId ? `__streaming__${chat.runId}__` : "__streaming__";
                  const lastIndex = nextMessages.length - 1;
                  const last = nextMessages[lastIndex];
                  if (last?.role === "assistant" && last.text.startsWith(streamingMarker)) {
                    const usage = extractUsageFromGatewayMessage(chat.message);
                    const newText = finalText || last.text.replace(streamingMarker, "");
                    nextMessages[lastIndex] = {
                      ...last,
                      text: newText,
                      parts: finalParts.length > 0 ? finalParts : [{ kind: "text", text: newText }],
                      model: chat.message?.model ?? last.model,
                      provider: chat.message?.provider ?? last.provider,
                      api: chat.message?.api ?? last.api,
                      timestamp: eventTimestamp,
                      input_tokens: usage.input_tokens ?? last.input_tokens,
                      output_tokens: usage.output_tokens ?? last.output_tokens,
                      cache_read_tokens: usage.cache_read_tokens ?? last.cache_read_tokens,
                      cache_write_tokens: usage.cache_write_tokens ?? last.cache_write_tokens,
                    };
                  } else if (finalText || finalParts.length > 0) {
                    nextMessages.push({ role: "assistant", text: finalText, parts: finalParts.length > 0 ? finalParts : [{ kind: "text", text: finalText }], model: chat.message?.model, provider: chat.message?.provider, api: chat.message?.api, timestamp: eventTimestamp, ...extractUsageFromGatewayMessage(chat.message) });
                  }
                  return {
                    ...currentConversation,
                    lastRole: "assistant",
                    latestEventType: terminalEventType,
                    lastMessage: finalText || currentConversation.lastMessage,
                    previewMessages: nextMessages,
                    updatedAt: eventTimestamp,
                    lastTime: eventLastTime,
                    runtime: {
                      ...currentConversation.runtime,
                      activeRunId: undefined,
                      activeStartedAt: undefined,
                      lastEventAt: eventTimestamp,
                      lastTerminalAt: eventTimestamp,
                      lastTerminalReason: chat.state === "aborted" ? "aborted" : "completed",
                    },
                  };
                });
              }),
            })));
            void refreshGatewayStatus();
            if (isCurrentConversation) {
              setTimeout(() => {
                void openConversationDetail(chat.sessionKey!);
              }, 1000);
            }
            return;
          }

          if (chat.state === "error") {
            if (isCurrentConversation && isCurrentRun) {
              setActiveRunId(null);
              setSending(false);
              setGatewayError(chat.errorMessage ?? "发送失败");
              setGatewayStatusText(`Gateway 请求失败: ${chat.errorMessage ?? "发送失败"}`);
            }
            setAgents((current) => current.map((agent) => ({
              ...agent,
              conversations: agent.conversations.map((conversation) => {
                if (conversation.id !== chat.sessionKey) return conversation;
                return patchConversation(conversation, (currentConversation) => ({
                  ...currentConversation,
                  latestEventType: "error",
                  runtime: {
                    ...currentConversation.runtime,
                    activeRunId: undefined,
                    activeStartedAt: undefined,
                    lastEventAt: Date.now(),
                    lastTerminalAt: Date.now(),
                    lastTerminalReason: "error",
                  },
                }));
              }),
            })));
          }
        });
        gatewayEventUnlistenRef.current = unlisten;
        dispose = () => {
          unlisten();
          gatewayEventUnlistenRef.current = null;
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setGatewayConnected(false);
        setGatewayError(message);
        setGatewayStatusText(`Gateway 事件订阅失败: ${message}`);
      }
    })();

    return () => {
      mounted = false;
      dispose?.();
    };
  }, [activeConversationId, refreshGatewayStatus, bootstrapStep]);

  const visibleConversations = useMemo(() => {
    return agents
      .flatMap((agent) =>
        agent.conversations
          .filter((conversation) => conversation.visible)
          .map((conversation) => ({
            ...conversation,
            agentId: agent.id,
            agentName: agent.name,
            color: agent.color,
          })),
      )
      .sort((left, right) => {
        const statusRank = { working: 0, completed: 1, idle: 2 };
        const byStatus = statusRank[left.status] - statusRank[right.status];
        if (byStatus !== 0) return byStatus;
        return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
      });
  }, [agents]);

  const filteredVisibleConversations = visibleConversations;

  // Always get activeConversation from agents to ensure we have the latest data
  // (including previewMessages updated by gateway_chat_history)
  const activeConversation = activeConversationId
    ? agents.flatMap((agent) => agent.conversations).find((conversation) => conversation.id === activeConversationId)
      ?? null
    : null;

  const resolveConversationDefaultModel = useCallback((conversation: Conversation | null) => {
    if (!conversation) {
      return MODEL_OPTIONS[0]?.value ?? "";
    }
    // Priority 1: last assistant message's model from previewMessages
    const lastAssistantModel = [...(conversation.previewMessages ?? [])]
      .reverse()
      .find((message) => message.role?.toLowerCase() === "assistant" && message.model)?.model;
    if (lastAssistantModel) return lastAssistantModel;
    // Priority 2: conversation-level model (from agent config)
    if (conversation.model && conversation.model !== "未配置") return conversation.model;
    // Priority 3: first model option as fallback
    return MODEL_OPTIONS[0]?.value ?? "";
  }, []);

  // Update composer model when conversation changes or previewMessages update
  useEffect(() => {
    setComposerModel(resolveConversationDefaultModel(activeConversation));
  }, [activeConversation?.id, resolveConversationDefaultModel]);

  const handleCreateConversation = useCallback(async (agentId: string) => {
    try {
      setGatewayError(null);
      await invoke("gateway_connect");
      const defaultModel = resolveAgentDefaultModel(agents, agentId);
      const result = await invoke<GatewayCreateSessionResult>("gateway_sessions_create", {
        params: {
          agentId,
          label: "新对话",
          model: defaultModel || null,
          message: "",
        },
      });
      const newKey = result.key;
      if (!newKey) {
        throw new Error("创建会话失败，未返回 session key");
      }
      const now = Date.now();
      setAgents((current) => current.map((agent) => {
        if (agent.id !== agentId) return agent;
        const nextConversation: Conversation = {
          id: newKey,
          title: "新对话",
          status: "idle",
          lastMessage: "",
          lastTime: new Date().toLocaleString("zh-CN"),
          updatedAt: now,
          tokens: "--",
          model: resolveAgentDefaultModel(current, agentId) || "未配置",
          workspace: agent.summary || "",
          visible: true,
          previewMessages: [],
        };
        return {
          ...agent,
          conversations: [nextConversation, ...agent.conversations],
        };
      }));
      setExpandedConversationId(newKey);
      setActiveConversationId(newKey);
      await refreshGatewayStatus();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setGatewayError(messageText);
      setGatewayConnected(false);
      setGatewayStatusText(`新建对话失败: ${messageText}`);
    }
  }, [agents, refreshGatewayStatus]);

  const toggleConversationVisibility = (agentId: string, conversationId: string, visible: boolean) => {
    setAgents((current) =>
      current.map((agent) =>
        agent.id !== agentId
          ? agent
          : {
              ...agent,
              conversations: agent.conversations.map((conversation) =>
                conversation.id !== conversationId ? conversation : { ...conversation, visible },
              ),
            },
      ),
    );

    if (visible) {
      setExpandedConversationId(conversationId);
    } else if (expandedConversationId === conversationId) {
      setExpandedConversationId("");
    }
  };

  const openConversationDetail = async (conversationId: string) => {
    setActiveConversationId(conversationId);
    setUserExpanded(false);
    try {
      // Ensure gateway is connected first
      await invoke("gateway_connect");
      const result = await invoke<GatewayHistoryResult>("gateway_chat_history", { params: { sessionKey: conversationId, limit: 200 } });
      await refreshGatewayStatus();
      if (Array.isArray(result?.messages)) {
        const mappedMessages = result.messages.map((message) => ({
          role: message.role,
          text: extractTextFromGatewayMessage(message),
          parts: mapGatewayContentToParts(message),
          model: message.model,
          provider: message.provider,
          api: message.api,
          timestamp: message.timestamp,
          ...extractUsageFromGatewayMessage(message),
        }));
        const lastAssistant = [...mappedMessages].reverse().find(m => m.role === "assistant");
        // Calculate total tokens from mapped messages
        const totalInput = mappedMessages.reduce((sum, m) => sum + (m.input_tokens || 0), 0);
        const totalOutput = mappedMessages.reduce((sum, m) => sum + (m.output_tokens || 0), 0);
        const totalCacheRead = mappedMessages.reduce((sum, m) => sum + (m.cache_read_tokens || 0), 0);
        const totalCacheWrite = mappedMessages.reduce((sum, m) => sum + (m.cache_write_tokens || 0), 0);
        const totalTokens = totalInput + totalOutput + totalCacheRead + totalCacheWrite;
        // Get last assistant message info
        const lastRole = mappedMessages.length > 0 ? (mappedMessages[mappedMessages.length - 1].role || "user") : undefined;
        setAgents((current) => current.map((agent) => ({
          ...agent,
          conversations: agent.conversations.map((conversation) => {
            if (conversation.id !== conversationId) return conversation;
            return patchConversation(conversation, (currentConversation) => ({
              ...currentConversation,
              previewMessages: mappedMessages,
              lastRole,
              lastMessage: lastAssistant?.text || currentConversation.lastMessage,
              model: lastAssistant?.model || currentConversation.model,
              inputTokens: totalInput,
              outputTokens: totalOutput,
              cacheReadTokens: totalCacheRead,
              cacheWriteTokens: totalCacheWrite,
              totalTokens,
              tokens: formatTokenCount(totalTokens),
              runtime: currentConversation.runtime ?? {
                activeRunId: undefined,
                activeStartedAt: undefined,
                lastEventAt: currentConversation.updatedAt,
                lastTerminalAt: lastAssistant ? currentConversation.updatedAt : undefined,
                lastTerminalReason: lastAssistant ? "completed" : undefined,
              },
            }));
          }),
        })));
      }
    } catch (error) {
      await refreshGatewayStatus();
      console.error("Failed to load chat history", error);
    }
  };

  useEffect(() => {
    const container = aiResponseScrollRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      const shouldStick = distanceToBottom < 80;
      shouldStickToBottomRef.current = shouldStick;
      setShowJumpToBottom(!shouldStick);
    };

    shouldStickToBottomRef.current = true;
    setShowJumpToBottom(false);
    handleScroll();
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [activeConversation?.id]);

  useEffect(() => {
    if (!activeConversation) {
      return;
    }
    const container = aiResponseScrollRef.current;
    if (!container) {
      return;
    }
    const raf = window.requestAnimationFrame(() => {
      if (!shouldStickToBottomRef.current) {
        return;
      }
      container.scrollTop = container.scrollHeight;
      setShowJumpToBottom(false);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [
    activeConversation?.id,
    activeConversation?.previewMessages?.length,
    activeConversation?.lastMessage,
    activeConversation?.updatedAt,
  ]);

  const handleComposerFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) {
      setGatewayError("当前只支持上传图片");
      return;
    }
    const next = await Promise.all(files.map(async (file) => {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
        reader.readAsDataURL(file);
      });
      return {
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        mimeType: file.type || "image/png",
        dataUrl,
        previewUrl: dataUrl,
      } satisfies ComposerAttachment;
    }));
    setComposerAttachments((current) => [...current, ...next]);
  }, []);

  const removeComposerAttachment = useCallback((attachmentId: string) => {
    setComposerAttachments((current) => current.filter((item) => item.id !== attachmentId));
  }, []);

  const handleAbort = useCallback(async () => {
    if (!activeConversationId || !sending) return;
    try {
      await invoke("gateway_connect");
      await invoke("gateway_chat_abort", {
        sessionKey: activeConversationId,
        runId: activeRunId,
      });
      setGatewayError(null);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setGatewayError(messageText);
      setGatewayStatusText(`停止失败: ${messageText}`);
    }
  }, [activeConversationId, activeRunId, sending]);

  const handleSend = useCallback(async () => {
    if (!activeConversationId || sending) return;
    const message = composerValue.trim();
    if (!message && composerAttachments.length === 0) return;

    const optimisticUserParts: MessagePart[] = [];
    if (message) {
      optimisticUserParts.push({ kind: "text", text: message });
    }
    optimisticUserParts.push(...composerAttachments.map((item) => ({
      kind: "image" as const,
      data: item.dataUrl,
      mime_type: item.mimeType,
      alt: item.name,
    })));

    setGatewayError(null);
    setSending(true);

    setAgents((current) => current.map((agent) => ({
      ...agent,
      conversations: agent.conversations.map((conversation) => {
        if (conversation.id !== activeConversationId) return conversation;
        return {
          ...conversation,
          status: "working",
          lastRole: "user",
          lastMessage: message || (composerAttachments.length > 0 ? `[图片] ${composerAttachments.map((item) => item.name).join(", ")}` : conversation.lastMessage),
          updatedAt: Date.now(),
          lastTime: new Date().toLocaleString("zh-CN"),
          previewMessages: [
            ...(conversation.previewMessages ?? []),
            { role: "user", text: message || composerAttachments.map((item) => `[图片] ${item.name}`).join("\n"), parts: optimisticUserParts },
          ],
        };
      }),
    })));

    const pendingAttachments = composerAttachments;
    setComposerValue("");
    setComposerAttachments([]);

    try {
      await invoke("gateway_connect");
      const runId = `clawx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setActiveRunId(runId);
      setAgents((current) => current.map((agent) => ({
        ...agent,
        conversations: agent.conversations.map((conversation) => {
          if (conversation.id !== activeConversationId) return conversation;
          return patchConversation(conversation, (currentConversation) => ({
            ...currentConversation,
            runtime: {
              ...currentConversation.runtime,
              activeRunId: runId,
              activeStartedAt: Date.now(),
              lastEventAt: Date.now(),
            },
          }));
        }),
      })));
      
      // 如果选择了不同的模型，先 patch 会话
      if (composerModel && composerModel !== activeConversation?.model) {
        await invoke("gateway_sessions_patch", {
          params: {
            sessionKey: activeConversationId,
            model: composerModel,
          },
        });
      }
      
      await invoke("gateway_chat_send", {
        params: {
          sessionKey: activeConversationId,
          message,
          idempotencyKey: runId,
          thinking: composerThinking === "off" ? null : composerThinking,
          attachments: pendingAttachments.map((item) => ({ dataUrl: item.dataUrl, mimeType: item.mimeType })),
        },
      });
      await refreshGatewayStatus();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setGatewayError(messageText);
      setGatewayStatusText(`Gateway 请求失败: ${messageText}`);
      setSending(false);
      setActiveRunId(null);
      setComposerAttachments(pendingAttachments);
      await refreshGatewayStatus();
    }
  }, [activeConversationId, composerAttachments, composerModel, composerThinking, composerValue, refreshGatewayStatus, sending]);



  if (bootstrapLoading) {
    return (
      <main className="bootstrap-screen">
        <div className="bootstrap-card">
          <strong>欢迎使用 clawx</strong>
          <p>首次启动会先检查本机 OpenClaw 环境，并确认是否允许 clawx 访问本地 Gateway。</p>
          <div className="bootstrap-meta">
            <span>步骤 1/3，检测本机 OpenClaw</span>
            <span>当前阶段: {bootstrapStep === "detect" ? "环境检测" : bootstrapStep}</span>
          </div>
        </div>
      </main>
    );
  }

  if (bootstrapError) {
    return (
      <main className="bootstrap-screen">
        <div className="bootstrap-card danger">
          <strong>读取 OpenClaw 状态失败</strong>
          <p>{bootstrapError}</p>
          <div className="bootstrap-actions">
            <button className="ghost-button" type="button" onClick={() => void loadBootstrapStatus()}>
              重试
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!bootstrapStatus?.openclawInstalled) {
    return (
      <main className="bootstrap-screen">
        <div className="bootstrap-card">
          <strong>先安装 OpenClaw，才能继续使用 clawx</strong>
          <p>clawx 本身不托管模型会话，它依赖本机 OpenClaw 提供 Gateway、配置和会话数据。所以第一次使用前，需要先完成 OpenClaw 安装。</p>
          <div className="bootstrap-meta">
            <span>步骤 2/3，等待安装 OpenClaw</span>
            <span>期望配置路径: {bootstrapStatus?.configPath ?? "~/.openclaw/openclaw.json"}</span>
          </div>
          <div className="bootstrap-actions">
            <button className="ghost-button" type="button" onClick={() => void loadBootstrapStatus()}>
              我已安装，重新检测
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!bootstrapStatus?.bindingConfigured) {
    return (
      <main className="bootstrap-screen">
        <div className="bootstrap-card">
          <strong>连接 OpenClaw</strong>
          <p>为了让 clawx 正常读取会话、发消息并接收流式回复，需要先授权它接入本机 OpenClaw Gateway。你确认后，clawx 会把下面这些配置写入你的 openclaw.json。</p>
          <div className="bootstrap-meta">
            <span>步骤 3/3，绑定本机 OpenClaw</span>
            <span>OpenClaw: {bootstrapStatus.openclawPath ?? "已安装"}</span>
            <span>配置文件: {bootstrapStatus.configPath}</span>
            <span>Gateway 端口: {bootstrapStatus.gatewayPort ?? 18789}</span>
          </div>
          <div className="code-block-shell">
            <div className="code-block-toolbar">
              <span className="code-block-language">将写入的配置</span>
            </div>
            <pre className="tool-entry-body code terminal-block">{bootstrapStatus.bindingWrites.join("\n")}</pre>
          </div>
          <div className="bootstrap-actions">
            <button className="ghost-button" type="button" onClick={() => void loadBootstrapStatus()} disabled={bindingInProgress}>
              刷新状态
            </button>
            <button className="primary-button" type="button" onClick={() => void bindOpenClaw()} disabled={bindingInProgress}>
              {bindingInProgress ? "正在写入并绑定..." : "同意并继续"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (bootstrapStep === "connect_test" || bootstrapConnectError) {
    return (
      <main className="bootstrap-screen">
        <div className={`bootstrap-card ${bootstrapConnectError ? "danger" : ""}`}>
          <strong>{bootstrapConnectError ? "OpenClaw 连接测试失败" : "正在验证 OpenClaw 连接"}</strong>
          <p>
            {bootstrapConnectError
              ? "配置已经写入，但 clawx 还没能成功连上本机 Gateway。你可以重试，或者先检查 OpenClaw Gateway 是否正在运行。"
              : "clawx 正在测试 Gateway 连接与流式能力，确认通过后才会进入主界面。"}
          </p>
          <div className="bootstrap-meta">
            <span>当前阶段: 连接测试</span>
            <span>Gateway 端口: {bootstrapStatus.gatewayPort ?? 18789}</span>
            {bootstrapConnectError ? <span>错误: {bootstrapConnectError}</span> : null}
          </div>
          {bootstrapConnectError ? (
            <div className="bootstrap-actions">
              <button className="ghost-button" type="button" onClick={() => void loadBootstrapStatus()}>
                重新检测环境
              </button>
              <button className="primary-button" type="button" onClick={() => setBootstrapStep("connect_test")}>
                重试连接
              </button>
            </div>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      {!gatewayConnected ? (
        <div className="global-gateway-banner" role="alert">
          <div className="global-gateway-banner-main">
            <strong>Gateway 不可用</strong>
            <span>{gatewayStatusText}</span>
          </div>
          {gatewayError ? <code className="global-gateway-banner-error">{gatewayError}</code> : null}
        </div>
      ) : null}
      {previewImageSrc && (
        <div className="image-lightbox" role="dialog" aria-modal="true" onClick={() => setPreviewImageSrc(null)}>
          <button className="image-lightbox-close" type="button" onClick={() => setPreviewImageSrc(null)}>×</button>
          <img className="image-lightbox-content" src={previewImageSrc} alt="预览大图" onClick={(event) => event.stopPropagation()} />
        </div>
      )}
      <div
        className={`layout no-topbar ${
          activeNav === "conversations"
            ? showResourceSidebar
              ? "with-resource-sidebar"
              : "without-resource-sidebar"
            : "content-only"
        }`}
      >
        <aside className="nav-sidebar">
          <div className="nav-group">
            <button
              className={`nav-item ${activeNav === "conversations" ? "active" : ""}`}
              onClick={() => setActiveNav("conversations")}
              type="button"
            >
              对话
            </button>
            <button
              className={`nav-item ${activeNav === "skills" ? "active" : ""}`}
              onClick={() => setActiveNav("skills")}
              type="button"
            >
              技能
            </button>
            <button
              className={`nav-item ${activeNav === "connections" ? "active" : ""}`}
              onClick={() => setActiveNav("connections")}
              type="button"
            >
              连接
            </button>
          </div>

          <div className="sidebar-bottom-actions">
            <button className="nav-icon-button" onClick={() => void openLocalOpenClaw()} title="打开本地 OpenClaw" type="button">
              🌐
            </button>
          </div>
        </aside>

        {activeNav === "conversations" ? (
          <>
            {showResourceSidebar ? (
              <aside className="resource-sidebar">
                <div className="panel-head panel-head-with-actions">
                  <button className="ghost-button full-width" type="button">
                    新建 Agent
                  </button>
                </div>
                <button
                  className="sidebar-handle inside"
                  onClick={() => setShowResourceSidebar(false)}
                  title="隐藏 Agent 区域"
                  type="button"
                >
                  <span>⟨</span>
                </button>

                <div className="agent-tree flat">
                  {agents.map((agent) => (
                    <section className="agent-group flat" key={agent.id}>
                      <div className="agent-group-head flat">
                        <div className="agent-group-title">
                          <span className="color-dot" style={{ backgroundColor: agent.color }} />
                          <strong className="agent-name">{agent.name}</strong>
                        </div>
                        <div className="agent-inline-actions">
                          <button className="icon-only-button" title="新建对话" type="button" onClick={() => void handleCreateConversation(agent.id)}>
                            ＋
                          </button>
                        </div>
                      </div>
                      <div className="conversation-tree flat">
                        {agent.conversations.map((conversation) => (
                          <button
                            className={`conversation-tree-item flat ${conversation.visible ? "visible" : "hidden"} ${expandedConversationId === conversation.id ? "selected" : ""}`}
                            key={conversation.id}
                            onClick={() => {
                              if (!conversation.visible) {
                                toggleConversationVisibility(agent.id, conversation.id, true);
                              } else {
                                setExpandedConversationId(conversation.id);
                              }
                            }}
                            type="button"
                          >
                            <span className="conversation-title">{conversation.title}</span>
                            <div className="conversation-inline-meta">
                              <span>{conversation.tokens}</span>
                              <span className={`status-badge ${conversation.status}`}>
                                {statusLabel[conversation.status]}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </aside>
            ) : (
              <aside className="resource-sidebar-collapsed">
                <button
                  className="sidebar-handle outside"
                  onClick={() => setShowResourceSidebar(true)}
                  title="展开 Agent 区域"
                  type="button"
                >
                  <span>⟩</span>
                </button>
              </aside>
            )}

            <section className="workspace-area chat-workspace-area">
              {activeConversation ? (
                <>
                  <ConversationDetail
                    activeConversation={activeConversation}
                    agentName={visibleConversations.find((conversation) => conversation.id === activeConversation.id)?.agentName ?? "未知 Agent"}
                    statusLabel={statusLabel}
                    onBack={(resetUserExpanded) => { setActiveConversationId(null); resetUserExpanded(); }}
                    resetUserExpanded={() => setUserExpanded(false)}
                    parseSenderMeta={parseSenderMeta}
                    userExpanded={userExpanded}
                    onUserExpandedChange={setUserExpanded}
                    aiResponseScrollRef={aiResponseScrollRef}
                    showJumpToBottom={showJumpToBottom}
                    onJumpToBottom={() => {
                      const container = aiResponseScrollRef.current;
                      if (!container) return;
                      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
                      shouldStickToBottomRef.current = true;
                      setShowJumpToBottom(false);
                    }}
                    conversationMessageList={(() => {
                      const detailState = getConversationDetailState(
                        activeConversation.previewMessages ?? [],
                        activeConversation.lastRole,
                        false,
                      );
                      const shouldShowInProgress = activeConversation.runtime?.activeRunId || detailState.isWaitingReply || detailState.isStillStreaming;
                      if (!detailState.hasRenderableContent && !shouldShowInProgress) return <p className="ai-empty-hint">暂无回复内容</p>;
                      
                      const messagesToShow = detailState.normalizedMessages;
                      
                      return (
                        <>
                          {detailState.hasRenderableContent ? (
                            <ConversationMessageList
                              messages={messagesToShow}
                              conversationId={activeConversation.id}
                              onOpenImage={setPreviewImageSrc}
                            />
                          ) : null}
                          {shouldShowInProgress && (
                            <div className="thinking-indicator-fixed" role="status" aria-live="polite">
                              <div className="thinking-dots" aria-hidden="true">
                                <span />
                                <span />
                                <span />
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  />

                  <ConversationComposer
                    focused={composerFocused}
                    value={composerValue}
                    model={composerModel}
                    thinking={composerThinking}
                    sending={sending}
                    attachments={composerAttachments}
                    modelOptions={MODEL_OPTIONS}
                    onFocusChange={setComposerFocused}
                    onValueChange={setComposerValue}
                    onModelChange={setComposerModel}
                    onThinkingChange={setComposerThinking}
                    onFilesSelected={handleComposerFiles}
                    onRemoveAttachment={removeComposerAttachment}
                    onSend={handleSend}
                    onAbort={handleAbort}
                  />
                </>
              ) : (
              <ConversationList
                conversations={filteredVisibleConversations}
                statusLabel={statusLabel}
                onOpen={openConversationDetail}
                onHide={(agentId, conversationId) => toggleConversationVisibility(agentId, conversationId, false)}
              />
              )}
              {!activeConversation && filteredVisibleConversations.length === 0 ? (
                <div className="empty-chat-state">
                  <strong>还没有可显示的对话</strong>
                  <p>先从左侧 Agent 树里展开一个会话，后续这里会支持直接新建对话。</p>
                </div>
              ) : null}
            </section>
          </>
        ) : null}

        {activeNav === "skills" ? (
          <section className="single-page">
            <div className="page-head-row">
              <div className="search-box wide">搜索 skill 名称或用途</div>
              <button className="ghost-button" type="button">
                刷新技能
              </button>
            </div>
            <div className="card-grid-panel">
              {skills.map((skill) => (
                <article className="info-card" key={skill.id}>
                  <div className="card-row">
                    <strong>{skill.name}</strong>
                    <span className={`toggle-badge ${skill.enabled ? "enabled" : "disabled"}`}>
                      {skill.enabled ? "已启用" : "未启用"}
                    </span>
                  </div>
                  <p>{skill.summary}</p>
                  <span className="path-text stacked">{skill.location}</span>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {activeNav === "connections" ? (
          <section className="single-page">
            <div className="card-grid-panel">
              {connections.map((connection) => (
                <article className="info-card" key={connection.id}>
                  <div className="card-row">
                    <strong>{connection.name}</strong>
                    <span className={`toggle-badge ${connection.status}`}>
                      {connectionLabel[connection.status]}
                    </span>
                  </div>
                  <p>{connection.detail}</p>
                  <div className="connection-meta stacked">
                    <span>{connection.config}</span>
                    <span>{connection.activity}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

export default App;
