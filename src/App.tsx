import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ConversationComposer } from "./components/ConversationComposer";
import { ConversationDetail } from "./components/ConversationDetail";
import { ConversationList } from "./components/ConversationList";
import { getConversationDetailState } from "./lib/conversationDetailState";
import type { Conversation, ConversationStatus, MessagePart, PreviewMessage } from "./types/conversation";
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
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    return "--";
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

  // Extract timestamp from header: [Mon 2026-04-20 16:43 GMT+8]
  const timeRegex = /\[([A-Za-z]+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s*GMT[+-]\d+)\]\s*\n?/;
  const timeMatch = cleanText.match(timeRegex);
  if (timeMatch) {
    const raw = timeMatch[1];
    // Format to just date+time
    time = raw.replace(/\s*GMT[+-]\d+/, "").replace(/^([A-Za-z]+\s+)(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})$/, "$2");
    cleanText = cleanText.replace(timeRegex, "");
  }

  // Extract sender metadata block
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

  // Try inline JSON form
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

function StructuredMessageContent({
  parts,
  conversationId,
  onOpenImage,
  imageVariant = "assistant",
  toolsExpandedByDefault = false,
}: {
  parts: MessagePart[];
  conversationId: string;
  onOpenImage: (src: string) => void;
  imageVariant?: "user" | "assistant" | "tool";
  toolsExpandedByDefault?: boolean;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(() => toolsExpandedByDefault ? new Set([0]) : new Set());
  const [expandedToolItems, setExpandedToolItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpandedGroups(toolsExpandedByDefault ? new Set([0]) : new Set());
    setExpandedToolItems(new Set());
  }, [conversationId, toolsExpandedByDefault]);

  const toggleGroup = useCallback((index: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const toggleToolItem = useCallback((key: string) => {
    setExpandedToolItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const isCodeLike = (text?: string) => {
    if (!text) return false;
    return /```|^\s*(import |export |const |let |var |function |class |<\w+|#include|SELECT |INSERT |UPDATE |DELETE )/m.test(text);
  };

  const summarize = (text?: string) => {
    if (!text) return "无结果";
    const oneLine = text.replace(/\s+/g, " ").trim();
    return oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine;
  };

  type ToolItem = { tool: string; args?: string; resultText?: string };
  const blocks: Array<
    | { kind: "text"; text: string }
    | { kind: "image"; part: Extract<MessagePart, { kind: "image" }> }
    | { kind: "tool_group"; items: ToolItem[] }
  > = [];

  let pendingToolItems: ToolItem[] = [];
  const flushTools = () => {
    if (pendingToolItems.length > 0) {
      blocks.push({ kind: "tool_group", items: pendingToolItems });
      pendingToolItems = [];
    }
  };

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.kind === "tool_call") {
      const next = parts[index + 1];
      if (next?.kind === "tool_result" && (next.tool ?? part.tool) === part.tool) {
        pendingToolItems.push({ tool: part.tool, args: part.args, resultText: next.text });
        index += 1;
        continue;
      }
      pendingToolItems.push({ tool: part.tool, args: part.args });
      continue;
    }
    if (part.kind === "tool_result") {
      pendingToolItems.push({ tool: part.tool ?? "tool", resultText: part.text });
      continue;
    }

    flushTools();

    if (part.kind === "image") {
      blocks.push({ kind: "image", part });
      continue;
    }
    blocks.push({ kind: "text", text: part.text });
  }
  flushTools();

  let toolGroupCounter = 0;

  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === "text") {
          return (
            <div className="message-bubble assistant" key={`${conversationId}-text-${index}`}>
              <span className="message-role">Assistant</span>
              <MarkdownBlock content={block.text} className="markdown-body" />
            </div>
          );
        }
        if (block.kind === "image") {
          const src = normalizeImageSrc(block.part.data, block.part.mime_type);
          return (
            <button className={`message-image-card ${imageVariant}`} key={`${conversationId}-image-${index}`} type="button" onClick={() => onOpenImage(src)}>
              <img className="message-image" src={src} alt={block.part.alt ?? "图片内容"} />
              <span className="message-image-badge">{imageVariant === "tool" ? "工具图片" : imageVariant === "user" ? "用户图片" : "图片"}</span>
            </button>
          );
        }

        const groupIndex = toolGroupCounter++;
        const groupKey = `${conversationId}-tool-group-${groupIndex}`;
        const expanded = expandedGroups.has(groupIndex);
        return (
          <div className="tool-group" key={groupKey}>
            <button className="tool-group-header" type="button" onClick={() => toggleGroup(groupIndex)}>
              <span className="tool-icon">⚡</span>
              <span className="tool-name">工具调用 {block.items.length} 项</span>
              <span className="tool-summary">{block.items.map((item) => item.tool).join(" · ")}</span>
              <span className="tool-toggle">{expanded ? "▲" : "▼"}</span>
            </button>
            {expanded ? (
              <div className="tool-group-list">
                {block.items.map((item, itemIndex) => {
                  const itemKey = `${groupKey}-item-${itemIndex}`;
                  const itemExpanded = expandedToolItems.has(itemKey);
                  return (
                    <div className="tool-entry grouped nested" key={itemKey}>
                      <button className="tool-entry-header" type="button" onClick={() => toggleToolItem(itemKey)}>
                        <span className="tool-icon">⚡</span>
                        <span className="tool-name">{item.tool}</span>
                        <span className="tool-entry-kind">#{itemIndex + 1}</span>
                        <span className="tool-summary">{summarize(item.resultText ?? item.args)}</span>
                        <span className="tool-toggle">{itemExpanded ? "▲" : "▼"}</span>
                      </button>
                      {itemExpanded ? (
                        <div className="tool-entry-stack">
                          {item.args ? (
                            <div className="tool-entry-section">
                              <div className="tool-entry-section-label">调用参数</div>
                              <pre className="tool-entry-body">{item.args}</pre>
                            </div>
                          ) : null}
                          {item.resultText ? (
                            <div className="tool-entry-section">
                              <div className="tool-entry-section-label">工具结果</div>
                              {isCodeLike(item.resultText)
                                ? <CodeBlock code={item.resultText} language={item.resultText.match(/```([\w-]+)/)?.[1] ?? "text"} />
                                : <MarkdownBlock content={item.resultText} className="tool-entry-body markdown-body" />}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
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
  const lastAssistantIndex = [...messages].map((message, index) => ({ message, index })).reverse().find((entry) => entry.message.role?.toLowerCase() === "assistant")?.index;
  const isStreaming = lastAssistantIndex != null && messages[lastAssistantIndex]?.text?.startsWith("__streaming__");

  const rows: Array<
    | { kind: "message"; message: PreviewMessage; index: number }
    | { kind: "tool_group"; items: Array<{ message: PreviewMessage; index: number }> }
  > = [];

  let pendingToolMessages: Array<{ message: PreviewMessage; index: number }> = [];
  const isToolLikeMessage = (message: PreviewMessage) => {
    const parts = message.parts ?? [];
    return parts.length > 0 && parts.every((part) => part.kind === "tool_call" || part.kind === "tool_result");
  };
  const flushToolMessages = () => {
    if (pendingToolMessages.length > 0) {
      rows.push({ kind: "tool_group", items: pendingToolMessages });
      pendingToolMessages = [];
    }
  };

  messages.forEach((message, index) => {
    if (isToolLikeMessage(message)) {
      pendingToolMessages.push({ message, index });
      return;
    }
    flushToolMessages();
    rows.push({ kind: "message", message, index });
  });
  flushToolMessages();

  return (
    <>
      {rows.map((row, rowIndex) => {
        if (row.kind === "tool_group") {
          return (
            <StructuredMessageContent
              key={`${conversationId}-tool-group-${rowIndex}`}
              parts={row.items.flatMap((item) => item.message.parts ?? [])}
              conversationId={`${conversationId}-tool-group-${rowIndex}`}
              onOpenImage={onOpenImage}
              imageVariant="tool"
              toolsExpandedByDefault={Boolean(isStreaming && row.items.some((item) => item.index === lastAssistantIndex))}
            />
          );
        }

        const { message, index } = row;
        const parts = message.parts?.length ? message.parts : [{ kind: "text", text: message.text } as MessagePart];
        const isAssistant = message.role?.toLowerCase() === "assistant";
        const showFooter = isAssistant && index === lastAssistantIndex && Boolean(message.model);
        return (
          <div className="message-stack" key={`${conversationId}-message-${index}`}>
            <StructuredMessageContent
              parts={parts}
              conversationId={`${conversationId}-${index}`}
              onOpenImage={onOpenImage}
              imageVariant={message.role?.toLowerCase() === "toolresult" ? "tool" : message.role?.toLowerCase() === "user" ? "user" : "assistant"}
              toolsExpandedByDefault={false}
            />
            {showFooter ? (
              <div className="assistant-message-footer">
                <span>↑{formatTokenCount(message.output_tokens)}</span>
                <span>↓{formatTokenCount(message.input_tokens)}</span>
                <span>R{formatTokenCount(message.cache_read_tokens)}</span>
                <span className="assistant-message-footer-divider">·</span>
                <span className="assistant-message-footer-model">{message.model}</span>
                {message.timestamp ? (
                  <>
                    <span className="assistant-message-footer-divider">·</span>
                    <span>{new Date(message.timestamp).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/** AI message renderer that separates text, tool calls, and tool results */
const deriveConversationStatus = (updatedAt?: number, lastRole?: string, latestEventType?: string) => {
  const normalizedRole = lastRole?.toLowerCase();
  const normalizedEventType = latestEventType?.toLowerCase();
  const now = Date.now();
  const isIdle = Boolean(updatedAt && now - updatedAt > 1000 * 60 * 30);
  if (isIdle) {
    return "idle" as const;
  }
  const hasActiveEvent = normalizedEventType
    ? ["message", "assistant_stream", "assistant_delta", "tool_call", "tool_result", "agent_turn", "turn_running"].includes(normalizedEventType)
    : false;
  if (normalizedRole === "user" || hasActiveEvent) {
    return "working" as const;
  }
  return "completed" as const;
};

function extractUsageFromGatewayMessage(message?: GatewayMessage | null) {
  return {
    input_tokens: message?.usage?.input,
    output_tokens: message?.usage?.output,
    cache_read_tokens: message?.usage?.cacheRead,
    cache_write_tokens: message?.usage?.cacheWrite,
  };
}

function extractTextFromGatewayMessage(message?: GatewayMessage | null) {
  if (!message) return "";
  if (typeof message.text === "string") return message.text;
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (part.type === "text") return part.text;
        if (part.type === "toolresult") return part.text ?? "";
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
    return message.content.trim() ? [{ kind: "text", text: message.content }] : [];
  }
  if (Array.isArray(message.content)) {
    return message.content.flatMap<MessagePart>((part) => {
      if (part.type === "text") {
        return part.text?.trim() ? [{ kind: "text", text: part.text }] : [];
      }
      if (part.type === "toolcall") {
        return [{ kind: "tool_call", tool: part.name ?? "tool", args: typeof part.arguments === "string" ? part.arguments : JSON.stringify(part.arguments ?? {}, null, 2) }];
      }
      if (part.type === "toolresult") {
        return [{ kind: "tool_result", tool: part.name, text: part.text }];
      }
      if (part.type === "image" || part.type === "input_image" || part.type === "image_url") {
        const src = part.data ?? part.url ?? part.image_url?.url;
        return src ? [{ kind: "image", data: src, mime_type: part.mimeType ?? part.mime_type, alt: part.text ?? part.alt }] : [];
      }
      return [];
    });
  }
  if (typeof message.text === "string" && message.text.trim()) {
    return [{ kind: "text", text: message.text }];
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

function buildAgentsFromSnapshot(snapshot: OpenClawSnapshot, currentAgentSnapshots: Agent[]): Agent[] {
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

        return {
          id: session.key,
          title: session.title,
          status: deriveConversationStatus(session.updated_at, latestRole, session.latest_event_type),
          lastMessage:
            latestAssistantMessage?.text ??
            session.last_message ??
            "暂无回复内容",
          previewMessages: session.preview_messages,
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
      conversations: realSessions.length > 0 ? realSessions : existing?.conversations ?? [],
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
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [gatewayStatusText, setGatewayStatusText] = useState("Gateway 连接中...");
  const [userExpanded, setUserExpanded] = useState(false);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const aiResponseScrollRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const gatewayEventUnlistenRef = useRef<null | (() => void)>(null);

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

        setAgents(buildAgentsFromSnapshot(snapshot, currentAgentSnapshots));

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

    void loadSnapshot();
    const interval = window.setInterval(() => {
      void loadSnapshot();
    }, 8000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
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
                return {
                  ...conversation,
                  status: deriveConversationStatus(nextUpdatedAt, nextLastRole, nextLatestEventType),
                  lastMessage: payload.session.lastMessage ?? conversation.lastMessage,
                  lastRole: nextLastRole,
                  latestEventRole: payload.session.latestEventRole?.toLowerCase() ?? conversation.latestEventRole,
                  latestEventType: nextLatestEventType,
                  updatedAt: nextUpdatedAt,
                  lastTime: nextUpdatedAt ? new Date(nextUpdatedAt).toLocaleString("zh-CN") : conversation.lastTime,
                  inputTokens: payload.session.inputTokens ?? conversation.inputTokens,
                  outputTokens: payload.session.outputTokens ?? conversation.outputTokens,
                  cacheReadTokens: payload.session.cacheReadTokens ?? conversation.cacheReadTokens,
                  cacheWriteTokens: payload.session.cacheWriteTokens ?? conversation.cacheWriteTokens,
                  totalTokens: nextTotalTokens,
                  tokens: formatTokenCount(nextTotalTokens),
                  model: payload.session.model ?? conversation.model,
                  // Don't overwrite previewMessages from session_patch.
                  // Preview messages are managed by the WebSocket delta/final handler.
                  // Session patches from the realtime subscription may carry stale preview data.
                  previewMessages: conversation.previewMessages,
                };
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGatewayConnected(false);
      setGatewayStatusText(`Gateway 状态获取失败: ${message}`);
      setGatewayError(message);
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

          if (chat.state === "delta") {
            const deltaText = extractTextFromGatewayMessage(chat.message);
            const deltaParts = mapGatewayContentToParts(chat.message);
            if (!deltaText && deltaParts.length === 0) return;
            setAgents((current) => current.map((agent) => ({
              ...agent,
              conversations: agent.conversations.map((conversation) => {
                if (conversation.id !== chat.sessionKey) return conversation;
                const nextMessages = [...(conversation.previewMessages ?? [])];
                const last = nextMessages[nextMessages.length - 1];
                if (last?.role === "assistant" && last.text.startsWith("__streaming__")) {
                  const previousText = last.text.replace(/^__streaming__/, "");
                  const mergedText = deltaText ? `${previousText}${deltaText}` : previousText;
                  last.text = `__streaming__${mergedText}`;
                  last.parts = deltaParts.length > 0 ? deltaParts : [{ kind: "text", text: mergedText }];
                  last.model = chat.message?.model ?? last.model;
                  last.provider = chat.message?.provider ?? last.provider;
                  last.api = chat.message?.api ?? last.api;
                  last.timestamp = chat.message?.timestamp ?? last.timestamp;
                  Object.assign(last, extractUsageFromGatewayMessage(chat.message));
                } else {
                  nextMessages.push({ role: "assistant", text: `__streaming__${deltaText}`, parts: deltaParts.length > 0 ? deltaParts : [{ kind: "text", text: deltaText }], model: chat.message?.model, provider: chat.message?.provider, api: chat.message?.api, timestamp: chat.message?.timestamp, ...extractUsageFromGatewayMessage(chat.message) });
                }
                return {
                  ...conversation,
                  status: "working",
                  lastRole: "assistant",
                  lastMessage: deltaText || conversation.lastMessage,
                  previewMessages: nextMessages,
                  updatedAt: Date.now(),
                  lastTime: new Date().toLocaleString("zh-CN"),
                };
              }),
            })));
            return;
          }

          if (chat.state === "final" || chat.state === "aborted") {
            setActiveRunId(null);
            const finalText = extractTextFromGatewayMessage(chat.message);
            const finalParts = mapGatewayContentToParts(chat.message);
            setSending(false);
            setAgents((current) => current.map((agent) => ({
              ...agent,
              conversations: agent.conversations.map((conversation) => {
                if (conversation.id !== chat.sessionKey) return conversation;
                const nextMessages = [...(conversation.previewMessages ?? [])];
                const last = nextMessages[nextMessages.length - 1];
                if (last?.role === "assistant" && last.text.startsWith("__streaming__")) {
                  if (finalText || finalParts.length > 0) {
                    last.text = finalText || last.text.replace(/^__streaming__/, "");
                    last.parts = finalParts.length > 0 ? finalParts : [{ kind: "text", text: finalText || last.text.replace(/^__streaming__/, "") }];
                  } else {
                    last.text = last.text.replace(/^__streaming__/, "");
                  }
                  last.model = chat.message?.model ?? last.model;
                  last.provider = chat.message?.provider ?? last.provider;
                  last.api = chat.message?.api ?? last.api;
                  last.timestamp = chat.message?.timestamp ?? last.timestamp;
                  Object.assign(last, extractUsageFromGatewayMessage(chat.message));
                } else if (finalText || finalParts.length > 0) {
                  nextMessages.push({ role: "assistant", text: finalText, parts: finalParts, model: chat.message?.model, provider: chat.message?.provider, api: chat.message?.api, timestamp: chat.message?.timestamp, ...extractUsageFromGatewayMessage(chat.message) });
                }
                return {
                  ...conversation,
                  status: "completed",
                  lastRole: "assistant",
                  lastMessage: finalText || conversation.lastMessage,
                  previewMessages: nextMessages,
                  updatedAt: Date.now(),
                  lastTime: new Date().toLocaleString("zh-CN"),
                };
              }),
            })));
            void refreshGatewayStatus();
            // Wait a moment for the gateway to persist the message, then refetch history
            // to ensure we have the complete message data (usage, parts, etc.)
            const sessionKey = chat.sessionKey;
            if (sessionKey) {
              setTimeout(() => {
                void openConversationDetail(sessionKey);
              }, 1000);
            }
            return;
          }

          if (chat.state === "error") {
            setActiveRunId(null);
            setSending(false);
            setGatewayError(chat.errorMessage ?? "发送失败");
            setGatewayStatusText(`Gateway 请求失败: ${chat.errorMessage ?? "发送失败"}`);
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
        const pinnedRank = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
        if (pinnedRank !== 0) return pinnedRank;
        const byStatus = statusRank[left.status] - statusRank[right.status];
        if (byStatus !== 0) return byStatus;
        return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
      });
  }, [agents]);

  const filteredVisibleConversations = visibleConversations;

  const activeConversation = activeConversationId
    ? filteredVisibleConversations.find((conversation) => conversation.id === activeConversationId)
      ?? agents.flatMap((agent) => agent.conversations).find((conversation) => conversation.id === activeConversationId)
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
        // If the last assistant message might still be streaming (recent update, assistant role last),
        // mark it with __streaming__ prefix so the delta handler appends to it correctly.
        const lastMsg = mappedMessages[mappedMessages.length - 1];
        const lastAssistant = [...mappedMessages].reverse().find(m => m.role === "assistant");
        const isPotentiallyStreaming = lastMsg?.role?.toLowerCase() === "assistant" || 
          (lastMsg?.role?.toLowerCase() === "user" && lastAssistant && Date.now() - (lastAssistant.timestamp || 0) < 300000);
        if (isPotentiallyStreaming && lastAssistant && !lastAssistant.text.startsWith("__streaming__")) {
          lastAssistant.text = `__streaming__${lastAssistant.text}`;
          if (lastAssistant.parts && lastAssistant.parts.length > 0) {
            const firstTextPart = lastAssistant.parts.find(p => p.kind === "text");
            if (firstTextPart && "text" in firstTextPart) {
              (firstTextPart as any).text = `__streaming__${(firstTextPart as any).text}`;
            }
          }
        }
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
            return {
              ...conversation,
              previewMessages: mappedMessages,
              status: "idle" as ConversationStatus,
              lastRole,
              lastMessage: lastAssistant?.text || conversation.lastMessage,
              model: lastAssistant?.model || conversation.model,
              inputTokens: totalInput,
              outputTokens: totalOutput,
              cacheReadTokens: totalCacheRead,
              cacheWriteTokens: totalCacheWrite,
              totalTokens,
              tokens: formatTokenCount(totalTokens),
            };
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
      shouldStickToBottomRef.current = distanceToBottom < 80;
    };

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
    if (!shouldStickToBottomRef.current) {
      return;
    }
    container.scrollTop = container.scrollHeight;
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
            { role: "assistant", text: "__streaming__", parts: [{ kind: "text", text: "" }] },
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
                    userExpanded={userExpanded}
                    onUserExpandedChange={setUserExpanded}
                    onBack={() => { setActiveConversationId(null); setUserExpanded(false); }}
                    onOpenImage={setPreviewImageSrc}
                    aiResponseScrollRef={aiResponseScrollRef}
                    parseSenderMeta={parseSenderMeta}
                    normalizeImageSrc={normalizeImageSrc}
                    conversationMessageList={(() => {
                      const detailState = getConversationDetailState(activeConversation.previewMessages ?? [], activeConversation.lastRole);
                      if (detailState.isWaitingReply) {
                        return (
                          <div className="message-bubble assistant assistant-thinking" role="status" aria-live="polite">
                            <span className="message-role">Assistant</span>
                            <div className="thinking-dots" aria-hidden="true">
                              <span />
                              <span />
                              <span />
                            </div>
                          </div>
                        );
                      }
                      if (!detailState.hasRenderableContent) return <p className="ai-empty-hint">暂无回复内容</p>;
                      return (
                        <>
                          <ConversationMessageList messages={detailState.normalizedMessages} conversationId={activeConversation.id} onOpenImage={setPreviewImageSrc} />
                          {detailState.isStillStreaming && (
                            <div className="message-bubble assistant assistant-thinking trailing" role="status" aria-live="polite">
                              <span className="message-role">Assistant</span>
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
