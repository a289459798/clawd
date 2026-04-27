import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ConversationComposer } from "./components/ConversationComposer";
import { ConversationDetail } from "./components/ConversationDetail";
import { ConversationList } from "./components/ConversationList";
import { ConversationMessageList } from "./components/ConversationMessageList";
import { getConversationDetailState } from "./lib/conversationDetailState";
import { extractTextFromGatewayMessage, extractUsageFromGatewayMessage, isInternalOpenClawMessage, mapGatewayContentToParts, mergeStreamingParts } from "./lib/gatewayMessages";
import type { Conversation, ConversationRuntime, MessagePart, PreviewMessage } from "./types/conversation";
import type { GatewayChatEvent, GatewayHistoryResult, GatewayModelsResult, GatewayStatus, OpenClawSnapshot } from "./types/gateway";
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

type ComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  previewUrl?: string;
};

type QueuedComposerMessage = {
  id: string;
  text: string;
  attachments: ComposerAttachment[];
  createdAt: number;
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

type ModelOption = {
  value: string;
  label: string;
};

const normalizeModelKey = (value: string) => value.trim().toLowerCase();

const qualifyModelId = (id: string, provider?: string) => {
  const trimmedId = id.trim();
  const trimmedProvider = provider?.trim();
  if (!trimmedId) return "";
  if (!trimmedProvider || trimmedId.includes("/")) return trimmedId;
  return `${trimmedProvider}/${trimmedId}`;
};

const buildModelOptions = (result?: GatewayModelsResult | null): ModelOption[] => {
  const models = Array.isArray(result?.models) ? result.models : [];
  const seen = new Set<string>();
  return models
    .map((model) => {
      const value = qualifyModelId(model.id, model.provider);
      if (!value) return null;
      const displayName = model.alias?.trim() || model.label?.trim() || model.name?.trim() || model.id.trim();
      const provider = model.provider?.trim();
      const label = provider && !displayName.toLowerCase().includes(provider.toLowerCase())
        ? `${displayName} · ${provider}`
        : displayName;
      return { value, label };
    })
    .filter((option): option is ModelOption => {
      if (!option) return false;
      const key = normalizeModelKey(option.value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const ensureSelectedModelOption = (options: ModelOption[], selectedModel: string): ModelOption[] => {
  const selected = selectedModel.trim();
  if (!selected) return options;
  if (options.some((option) => normalizeModelKey(option.value) === normalizeModelKey(selected))) {
    return options;
  }
  return [{ value: selected, label: `当前: ${selected}` }, ...options];
};

const stringifyToolValue = (value: unknown) => {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const mapGatewayToolStreamToPart = (data?: Record<string, unknown>): Extract<MessagePart, { kind: "tool_call" | "tool_result" }> | null => {
  if (!data) return null;
  const name = typeof data.name === "string" && data.name.trim() ? data.name : "tool";
  const phase = typeof data.phase === "string" ? data.phase : "";
  if (phase === "result") {
    const text = stringifyToolValue(data.result ?? data.partialResult);
    return { kind: "tool_result", tool: name, text };
  }
  return { kind: "tool_call", tool: name, args: stringifyToolValue(data.args) };
};

const hasToolParts = (parts: MessagePart[] = []) => parts.some((part) => part.kind === "tool_call" || part.kind === "tool_result");

const messageOrderKey = (message: PreviewMessage) => {
  const role = message.role?.toLowerCase() ?? "";
  const timestamp = message.timestamp ?? "";
  const text = (message.text ?? "").replace(/^__streaming__(?:[^_]+__)?/, "");
  const parts = JSON.stringify(message.parts ?? []);
  return `${role}|${timestamp}|${text}|${parts}`;
};

const mergeSnapshotMessagesPreservingCurrentOrder = (currentMessages: PreviewMessage[] = [], snapshotMessages: PreviewMessage[] = []) => {
  if (currentMessages.length === 0) return snapshotMessages;
  if (snapshotMessages.length === 0) return currentMessages;

  const seen = new Set(currentMessages.map(messageOrderKey));
  const next = [...currentMessages];
  for (const message of snapshotMessages) {
    const key = messageOrderKey(message);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(message);
  }
  return next;
};

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
        const sessionMessages = (session.preview_messages || []).filter((message) => !isInternalOpenClawMessage(message));
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
          lastMessage: (() => {
            // Check if latest assistant message has tool calls
            const hasToolCalls = latestAssistantMessage?.parts?.some((p) => p.kind === "tool_call");
            const text = latestAssistantMessage?.text ?? session.last_message ?? "";
            if (hasToolCalls && text) {
              return `🔧 使用了工具 · ${text.slice(0, 50)}${text.length > 50 ? "..." : ""}`;
            }
            if (hasToolCalls) {
              return "🔧 使用了工具";
            }
            return text || "暂无回复内容";
          })(),
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
          model: latestAssistantMessage?.model ?? agent.model ?? existing?.model ?? "未配置",
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

function resolveAgentDefaultModel(agents: Agent[], agentId: string, modelOptions: ModelOption[]) {
  const agent = agents.find((item) => item.id === agentId);
  if (agent?.model && agent.model !== "未配置") {
    return agent.model;
  }
  return modelOptions[0]?.value ?? "";
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
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [composerModel, setComposerModel] = useState("");
  const [composerThinking, setComposerThinking] = useState("off");
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [queuedMessagesByConversation, setQueuedMessagesByConversation] = useState<Record<string, QueuedComposerMessage[]>>({});
  const [sending, setSending] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const reloadedConversationIdsRef = useRef<Set<string>>(new Set());
  const autoSendingQueuedMessageRef = useRef<string | null>(null);
  const queuedMessagesByConversationRef = useRef<Record<string, QueuedComposerMessage[]>>({});
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

  useEffect(() => {
    queuedMessagesByConversationRef.current = queuedMessagesByConversation;
  }, [queuedMessagesByConversation]);

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

    const loadModels = async () => {
      setModelsLoading(true);
      try {
        await invoke("gateway_connect");
        const result = await invoke<GatewayModelsResult>("gateway_models_list");
        if (!cancelled) {
          setModelOptions(buildModelOptions(result));
        }
      } catch (error) {
        console.error("Failed to load OpenClaw models", error);
        if (!cancelled) {
          setModelOptions([]);
        }
      } finally {
        if (!cancelled) {
          setModelsLoading(false);
        }
      }
    };

    // Load snapshot only once on startup
    // Polling removed to avoid overwriting frontend state (token data, streaming messages, tools)
    void loadSnapshot();
    void loadModels();

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
                const nextPreviewMessages = payload.session.previewMessages?.length
                  ? (payload.session.previewMessages as PreviewMessage[]).filter((message) => !isInternalOpenClawMessage(message))
                  : conversation.previewMessages;
                const latestSnapshotMessage = nextPreviewMessages?.[nextPreviewMessages.length - 1];
                const latestSnapshotParts = latestSnapshotMessage?.parts ?? [];
                const latestIsToolOnly = latestSnapshotParts.some((part) => part.kind === "tool_call" || part.kind === "tool_result")
                  && !latestSnapshotParts.some((part) => part.kind === "text" && part.text?.trim());
                const isTerminalSnapshot = ["turn_completed", "completed", "final", "aborted", "error", "failed", "cancelled"].includes(nextLatestEventType ?? "");
                const nextRuntime = latestIsToolOnly && !isTerminalSnapshot
                  ? {
                      ...conversation.runtime,
                      activeRunId: conversation.runtime?.activeRunId ?? `snapshot-tool-${payload.session.key}`,
                      activeStartedAt: conversation.runtime?.activeStartedAt ?? nextUpdatedAt ?? Date.now(),
                      lastEventAt: nextUpdatedAt,
                    }
                  : conversation.runtime ?? {
                      activeRunId: undefined,
                      activeStartedAt: undefined,
                      lastEventAt: nextUpdatedAt,
                      lastTerminalAt: nextLastRole === "assistant" ? nextUpdatedAt : undefined,
                      lastTerminalReason: nextLastRole === "assistant" ? "completed" : undefined,
                    };
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
                  previewMessages: currentConversation.runtime?.activeRunId
                    ? mergeSnapshotMessagesPreservingCurrentOrder(currentConversation.previewMessages, nextPreviewMessages)
                    : nextPreviewMessages,
                  runtime: nextRuntime,
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

          if (chat.stream === "tool") {
            const toolPart = mapGatewayToolStreamToPart(chat.data);
            if (!toolPart) return;
            const toolName = toolPart.kind === "tool_call" ? toolPart.tool : toolPart.tool ?? "tool";
            const toolRunId = chat.runId ?? activeRunIdRef.current ?? `tool-stream-${chat.sessionKey}`;
            setAgents((current) => current.map((agent) => ({
              ...agent,
              conversations: agent.conversations.map((conversation) => {
                if (conversation.id !== chat.sessionKey) return conversation;
                return patchConversation(conversation, (currentConversation) => {
                  const nextMessages = [...(currentConversation.previewMessages ?? [])];
                  const toolKey = `${toolRunId}:${toolName}`;
                  const existingIndex = nextMessages.findIndex((message) =>
                    message.role?.toLowerCase() === "assistant"
                    && message.text === toolKey
                    && (message.parts ?? []).some((part) => part.kind === "tool_call" && part.tool === toolName),
                  );
                  if (existingIndex >= 0) {
                    const existing = nextMessages[existingIndex];
                    nextMessages[existingIndex] = {
                      ...existing,
                      parts: mergeStreamingParts(existing.parts ?? [], [toolPart], ""),
                      timestamp: eventTimestamp,
                    };
                  } else {
                    nextMessages.push({
                      role: "assistant",
                      text: toolKey,
                      parts: [toolPart],
                      timestamp: eventTimestamp,
                    });
                  }
                  return {
                    ...currentConversation,
                    lastRole: "assistant",
                    latestEventType: "tool_stream",
                    lastMessage: `🔧 ${toolName}`,
                    previewMessages: nextMessages,
                    updatedAt: eventTimestamp,
                    lastTime: eventLastTime,
                    runtime: {
                      ...currentConversation.runtime,
                      activeRunId: toolRunId,
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

          if (chat.state === "delta") {
            // Check if this is the first delta of a new run (status changed to working)
            // If so, reload conversation data first to ensure we have complete history
            if (isCurrentConversation && chat.runId) {
              const currentConversation = agents.flatMap((agent) => agent.conversations)
                .find((conv) => conv.id === chat.sessionKey);
              const previousStatus = currentConversation?.status;
              
              // If status changed from completed/idle to working, reload conversation messages in background
              // without refreshing the entire page or changing UI state
              // Only reload once per runId to avoid multiple calls
              if (previousStatus && (previousStatus === "completed" || previousStatus === "idle") && chat.runId) {
                const reloadKey = `${chat.sessionKey}:${chat.runId}`;
                if (!reloadedConversationIdsRef.current.has(reloadKey)) {
                  reloadedConversationIdsRef.current.add(reloadKey);
                  // Load messages in background without affecting current UI state
                  void (async () => {
                    try {
                      const result = await invoke<GatewayHistoryResult>("gateway_chat_history", { 
                        params: { sessionKey: chat.sessionKey, limit: 200 } 
                      });
                      if (Array.isArray(result?.messages)) {
                        const sortedMessages = [...result.messages].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
                        const mappedMessages = sortedMessages
                          .filter((message) => !isInternalOpenClawMessage(message))
                          .map((message) => ({
                            role: message.role,
                            text: extractTextFromGatewayMessage(message),
                            parts: mapGatewayContentToParts(message),
                            model: message.model,
                            provider: message.provider,
                            api: message.api,
                            timestamp: message.timestamp,
                            senderLabel: message.senderLabel,
                            ...extractUsageFromGatewayMessage(message),
                          }))
                          .filter((message) => {
                            const hasText = Boolean(message.text?.trim());
                            const hasParts = Boolean(message.parts?.length);
                            return hasText || hasParts || message.role?.toLowerCase() === "user";
                          });
                        // Update only previewMessages, preserve all other state
                        setAgents((current) => current.map((agent) => ({
                          ...agent,
                          conversations: agent.conversations.map((conversation) => {
                            if (conversation.id !== chat.sessionKey) return conversation;
                            return {
                              ...conversation,
                              previewMessages: mappedMessages,
                            };
                          }),
                        })));
                      }
                    } catch (error) {
                      console.error("Failed to reload messages:", error);
                    }
                  })();
                }
              }
            }

            const deltaText = extractTextFromGatewayMessage(chat.message);
            const deltaParts = mapGatewayContentToParts(chat.message);
            if (!deltaText && deltaParts.length === 0) return;
            setAgents((current) => current.map((agent) => ({
              ...agent,
              conversations: agent.conversations.map((conversation) => {
                if (conversation.id !== chat.sessionKey) return conversation;
                return patchConversation(conversation, (currentConversation) => {
                  const nextMessages = [...(currentConversation.previewMessages ?? [])];
                  const effectiveRunId = chat.runId ?? currentConversation.runtime?.activeRunId ?? activeRunIdRef.current ?? `run-${eventTimestamp}`;
                  const streamingMarker = `__streaming__${effectiveRunId}__`;
                  const lastIndex = nextMessages.length - 1;
                  const last = nextMessages[lastIndex];
                  if (last?.role === "assistant" && last.text.startsWith(streamingMarker)) {
                    const usage = extractUsageFromGatewayMessage(chat.message);
                    const previousText = last.text.replace(streamingMarker, "");
                    const mergedParts = mergeStreamingParts(last.parts ?? [], deltaParts, deltaText);
                    const mergedTextPart = mergedParts
                      .flatMap((part) => part.kind === "text" ? [part.text] : [])
                      .join("");
                    const nextText = mergedTextPart || `${previousText}${deltaText}`;
                    nextMessages[lastIndex] = {
                      ...last,
                      text: `${streamingMarker}${nextText}`,
                      parts: mergedParts.length > 0 ? mergedParts : [{ kind: "text", text: nextText }],
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
                      const initialParts: MessagePart[] = deltaParts.length > 0 ? mergeStreamingParts([], deltaParts, deltaText) : [{ kind: "text", text: deltaText }];
                      const initialText = initialParts
                        .filter((part) => part.kind === "text")
                        .map((part) => part.text)
                        .join("") || deltaText;
                      nextMessages.push({ role: "assistant", text: `${streamingMarker}${initialText}`, parts: initialParts, model: chat.message?.model, provider: chat.message?.provider, api: chat.message?.api, timestamp: eventTimestamp, ...extractUsageFromGatewayMessage(chat.message) });
                    }
                  }
                  const latestPreview = nextMessages[nextMessages.length - 1];
                  const latestRenderedText = latestPreview?.text?.replace(streamingMarker, "") || deltaText;
                  return {
                    ...currentConversation,
                    lastRole: "assistant",
                    latestEventType: "assistant_stream",
                    lastMessage: latestRenderedText || currentConversation.lastMessage,
                    previewMessages: nextMessages,
                    updatedAt: eventTimestamp,
                    lastTime: eventLastTime,
                    runtime: {
                      ...currentConversation.runtime,
                      activeRunId: effectiveRunId,
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
                  const effectiveRunId = chat.runId ?? currentConversation.runtime?.activeRunId ?? activeRunIdRef.current ?? `run-${eventTimestamp}`;
                  const streamingMarker = `__streaming__${effectiveRunId}__`;
                  const lastIndex = nextMessages.length - 1;
                  const last = nextMessages[lastIndex];
                  if (last?.role === "assistant" && last.text.startsWith(streamingMarker)) {
                    const usage = extractUsageFromGatewayMessage(chat.message);
                    const fallbackText = last.text.replace(streamingMarker, "");
                    const hasExistingToolMessages = nextMessages.some((message, index) => index !== lastIndex && hasToolParts(message.parts ?? []));
                    const finalTextOnlyParts = finalParts.filter((part) => part.kind === "text" || part.kind === "image");
                    const mergedFinalParts = finalParts.length > 0 && !hasExistingToolMessages
                      ? mergeStreamingParts([], finalParts, finalText)
                      : mergeStreamingParts(last.parts ?? [], finalTextOnlyParts, finalText || fallbackText);
                    const renderedFinalText = mergedFinalParts
                      .flatMap((part) => part.kind === "text" ? [part.text] : [])
                      .join("") || finalText || fallbackText;
                    nextMessages[lastIndex] = {
                      ...last,
                      text: renderedFinalText,
                      parts: mergedFinalParts.length > 0 ? mergedFinalParts : [{ kind: "text", text: renderedFinalText }],
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
                    const hasExistingToolMessages = nextMessages.some((message) => hasToolParts(message.parts ?? []));
                    const finalTextOnlyParts = finalParts.filter((part) => part.kind === "text" || part.kind === "image");
                    const appendedParts: MessagePart[] = finalParts.length > 0 && !hasExistingToolMessages
                      ? mergeStreamingParts([], finalParts, finalText)
                      : finalTextOnlyParts.length > 0
                        ? mergeStreamingParts([], finalTextOnlyParts, finalText)
                        : [{ kind: "text", text: finalText }];
                    nextMessages.push({ role: "assistant", text: finalText, parts: appendedParts, model: chat.message?.model, provider: chat.message?.provider, api: chat.message?.api, timestamp: eventTimestamp, ...extractUsageFromGatewayMessage(chat.message) });
                  }
                  const latestPreview = nextMessages[nextMessages.length - 1];
                  const latestRenderedText = latestPreview?.text || finalText;
                  return {
                    ...currentConversation,
                    lastRole: "assistant",
                    latestEventType: terminalEventType,
                    lastMessage: latestRenderedText || currentConversation.lastMessage,
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
      return modelOptions[0]?.value ?? "";
    }
    // Priority 1: last assistant message's model from previewMessages
    const lastAssistantModel = [...(conversation.previewMessages ?? [])]
      .reverse()
      .find((message) => message.role?.toLowerCase() === "assistant" && message.model)?.model;
    if (lastAssistantModel) return lastAssistantModel;
    // Priority 2: conversation-level model (from agent config)
    if (conversation.model && conversation.model !== "未配置") return conversation.model;
    // Priority 3: first model option as fallback
    return modelOptions[0]?.value ?? "";
  }, [modelOptions]);

  // Update composer model when conversation changes or previewMessages update
  useEffect(() => {
    setComposerModel(resolveConversationDefaultModel(activeConversation));
  }, [activeConversation?.id, resolveConversationDefaultModel]);

  const handleCreateConversation = useCallback(async (agentId: string) => {
    try {
      setGatewayError(null);
      await invoke("gateway_connect");
      const defaultModel = resolveAgentDefaultModel(agents, agentId, modelOptions);
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
          model: resolveAgentDefaultModel(current, agentId, modelOptions) || "未配置",
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

  const openConversationDetail = async (conversationId: string, preserveStatus = false) => {
    setActiveConversationId(conversationId);
    setUserExpanded(false);
    try {
      // Ensure gateway is connected first
      await invoke("gateway_connect");
      const result = await invoke<GatewayHistoryResult>("gateway_chat_history", { params: { sessionKey: conversationId, limit: 200 } });
      await refreshGatewayStatus();
      if (Array.isArray(result?.messages)) {
        // Sort messages by timestamp to ensure correct chronological order
        const sortedMessages = [...result.messages].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
        const mappedMessages = sortedMessages
          .filter((message) => !isInternalOpenClawMessage(message))
          .map((message) => ({
          role: message.role,
          text: extractTextFromGatewayMessage(message),
          parts: mapGatewayContentToParts(message),
          model: message.model,
          provider: message.provider,
          api: message.api,
          timestamp: message.timestamp,
          senderLabel: message.senderLabel,
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
            // If preserveStatus is true, preserve all status-related fields
            // This is used when reloading data while already in the conversation
            if (preserveStatus) {
              return {
                ...conversation,
                previewMessages: mappedMessages,
                lastMessage: lastAssistant?.text || conversation.lastMessage,
                model: lastAssistant?.model || conversation.model,
                inputTokens: totalInput,
                outputTokens: totalOutput,
                cacheReadTokens: totalCacheRead,
                cacheWriteTokens: totalCacheWrite,
                totalTokens,
                tokens: formatTokenCount(totalTokens),
                // Preserve all status-related fields
                status: conversation.status,
                lastRole: conversation.lastRole,
                runtime: conversation.runtime,
              };
            }
            // Normal update with status calculation
            const updatedConversation = {
              ...conversation,
              previewMessages: mappedMessages,
              lastRole,
              lastMessage: lastAssistant?.text || conversation.lastMessage,
              model: lastAssistant?.model || conversation.model,
              inputTokens: totalInput,
              outputTokens: totalOutput,
              cacheReadTokens: totalCacheRead,
              cacheWriteTokens: totalCacheWrite,
              totalTokens,
              tokens: formatTokenCount(totalTokens),
              runtime: conversation.runtime ?? {
                activeRunId: undefined,
                activeStartedAt: undefined,
                lastEventAt: conversation.updatedAt,
                lastTerminalAt: lastAssistant ? conversation.updatedAt : undefined,
                lastTerminalReason: lastAssistant ? "completed" : undefined,
              },
            };
            return patchConversation(conversation, () => updatedConversation);
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

  const activeQueuedMessages = activeConversationId ? queuedMessagesByConversation[activeConversationId] ?? [] : [];

  const enqueueComposerMessage = useCallback((conversationId: string, text: string, attachments: ComposerAttachment[]) => {
    const item: QueuedComposerMessage = {
      id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      attachments,
      createdAt: Date.now(),
    };
    setQueuedMessagesByConversation((current) => ({
      ...current,
      [conversationId]: [...(current[conversationId] ?? []), item],
    }));
  }, []);

  const removeQueuedMessage = useCallback((messageId: string) => {
    if (!activeConversationId) return;
    setQueuedMessagesByConversation((current) => ({
      ...current,
      [activeConversationId]: (current[activeConversationId] ?? []).filter((item) => item.id !== messageId),
    }));
  }, [activeConversationId]);

  const sendMessageToConversation = useCallback(async (
    conversationId: string,
    message: string,
    attachments: ComposerAttachment[],
    options?: { restoreToComposerOnError?: boolean; requeueOnError?: QueuedComposerMessage },
  ) => {
    const optimisticUserParts: MessagePart[] = [];
    if (message) {
      optimisticUserParts.push({ kind: "text", text: message });
    }
    optimisticUserParts.push(...attachments.map((item) => ({
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
        if (conversation.id !== conversationId) return conversation;
        return {
          ...conversation,
          status: "working",
          lastRole: "user",
          lastMessage: message || (attachments.length > 0 ? `[图片] ${attachments.map((item) => item.name).join(", ")}` : conversation.lastMessage),
          updatedAt: Date.now(),
          lastTime: new Date().toLocaleString("zh-CN"),
          previewMessages: [
            ...(conversation.previewMessages ?? []),
            { role: "user", text: message || attachments.map((item) => `[图片] ${item.name}`).join("\n"), parts: optimisticUserParts },
          ],
        };
      }),
    })));

    try {
      await invoke("gateway_connect");
      const runId = `clawx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setActiveRunId(runId);
      setAgents((current) => current.map((agent) => ({
        ...agent,
        conversations: agent.conversations.map((conversation) => {
          if (conversation.id !== conversationId) return conversation;
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

      const targetConversation = agents.flatMap((agent) => agent.conversations).find((conversation) => conversation.id === conversationId);
      if (composerModel && composerModel !== targetConversation?.model) {
        await invoke("gateway_sessions_patch", {
          params: {
            sessionKey: conversationId,
            model: composerModel,
          },
        });
      }

      await invoke("gateway_chat_send", {
        params: {
          sessionKey: conversationId,
          message,
          idempotencyKey: runId,
          thinking: composerThinking === "off" ? null : composerThinking,
          attachments: attachments.map((item) => ({ dataUrl: item.dataUrl, mimeType: item.mimeType })),
        },
      });
      await refreshGatewayStatus();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setGatewayError(messageText);
      setGatewayStatusText(`Gateway 请求失败: ${messageText}`);
      setSending(false);
      setActiveRunId(null);
      if (options?.restoreToComposerOnError) {
        setComposerValue(message);
        setComposerAttachments(attachments);
      }
      if (options?.requeueOnError) {
        setQueuedMessagesByConversation((current) => ({
          ...current,
          [conversationId]: [options.requeueOnError!, ...(current[conversationId] ?? [])],
        }));
      }
      await refreshGatewayStatus();
    }
  }, [agents, composerModel, composerThinking, refreshGatewayStatus]);

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
    if (!activeConversationId) return;
    const message = composerValue.trim();
    const attachments = composerAttachments;
    if (!message && attachments.length === 0) return;

    const shouldQueue = sending || activeConversation?.status === "working" || Boolean(activeConversation?.runtime?.activeRunId);
    setComposerValue("");
    setComposerAttachments([]);

    if (shouldQueue) {
      enqueueComposerMessage(activeConversationId, message, attachments);
      return;
    }

    await sendMessageToConversation(activeConversationId, message, attachments, { restoreToComposerOnError: true });
  }, [activeConversation, activeConversationId, composerAttachments, composerValue, enqueueComposerMessage, sendMessageToConversation, sending]);

  useEffect(() => {
    if (!activeConversationId || !activeConversation || sending) return;
    if (activeConversation.status === "working" || activeConversation.runtime?.activeRunId) return;
    const nextQueuedMessage = queuedMessagesByConversation[activeConversationId]?.[0];
    if (!nextQueuedMessage) return;
    if (autoSendingQueuedMessageRef.current === nextQueuedMessage.id) return;

    autoSendingQueuedMessageRef.current = nextQueuedMessage.id;
    const remainingQueuedMessages = (queuedMessagesByConversationRef.current[activeConversationId] ?? []).filter((item) => item.id !== nextQueuedMessage.id);
    setQueuedMessagesByConversation((current) => ({
      ...current,
      [activeConversationId]: remainingQueuedMessages,
    }));
    void sendMessageToConversation(activeConversationId, nextQueuedMessage.text, nextQueuedMessage.attachments, { requeueOnError: nextQueuedMessage })
      .finally(() => {
        if (autoSendingQueuedMessageRef.current === nextQueuedMessage.id) {
          autoSendingQueuedMessageRef.current = null;
        }
        if (remainingQueuedMessages.length > 0) {
          setSending(false);
          setActiveRunId(null);
        }
      });
  }, [activeConversation, activeConversationId, queuedMessagesByConversation, sendMessageToConversation, sending]);




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
                        false, // Only show messages after last user message
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
                              formatTokenCount={formatTokenCount}
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
                    queuedMessages={activeQueuedMessages}
                    modelOptions={ensureSelectedModelOption(modelOptions, composerModel)}
                    modelsLoading={modelsLoading}
                    onFocusChange={setComposerFocused}
                    onValueChange={setComposerValue}
                    onModelChange={setComposerModel}
                    onThinkingChange={setComposerThinking}
                    onFilesSelected={handleComposerFiles}
                    onRemoveAttachment={removeComposerAttachment}
                    onRemoveQueuedMessage={removeQueuedMessage}
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
