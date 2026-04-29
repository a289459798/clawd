import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GatewayBanner, ImageLightbox, NavSidebar } from "./components/AppChrome";
import { AgentCreateDialog } from "./components/AgentCreateDialog";
import { BootstrapScreens } from "./components/BootstrapScreens";
import { ConversationWorkspace } from "./components/ConversationWorkspace";
import { ConnectionsPage, SkillsPage, UsagePage } from "./components/InfoPages";
import { ResourceSidebar } from "./components/ResourceSidebar";
import { getLastAssistantMessage, mapGatewayHistoryMessages, resolveConversationDefaultModel as resolveConversationModel, summarizeMessageUsage } from "./lib/conversationHistory";
import { findConversationById, getVisibleConversations } from "./lib/conversationSelectors";
import { readImageComposerAttachments } from "./lib/composerAttachments";
import { useConversationAutoScroll } from "./hooks/useConversationAutoScroll";
import { useGatewayChat } from "./hooks/useGatewayChat";
import { useGatewaySnapshot } from "./hooks/useGatewaySnapshot";
import { useMessageSender } from "./hooks/useMessageSender";
import { useModels } from "./hooks/useModels";
import { buildAgentsFromSnapshot, patchConversation, resolveAgentDefaultModel } from "./lib/agentsSnapshot";
import { connectionLabel, formatTokenCount, statusLabel } from "./lib/appFormatters";
import { parseSenderMeta } from "./lib/messageMeta";
import { mergeSnapshotMessagesPreservingCurrentOrder } from "./lib/toolStream";
import { isInternalOpenClawMessage } from "./lib/gatewayMessages";
import type { Conversation, PreviewMessage } from "./types/conversation";
import type { Agent, ChannelConnection, ClawxBootstrapStatus, ComposerAttachment, NavKey, QueuedComposerMessage, Skill } from "./types/app";
import type { GatewayAgentsCreateResult, GatewayChannelsStatusResult, GatewayHistoryResult, GatewayOpenClawStatusResult, GatewaySessionsUsageResult, GatewaySkillsStatusResult, GatewaySkillsUpdateResult, GatewayStatus, OpenClawSnapshot } from "./types/gateway";
import type { RealtimeGatewayEvent, RealtimeSessionMessageEvent } from "./realtime";
import "./App.css";

const agentsSeed: Agent[] = [];
const fallbackSkills: Skill[] = [];
const fallbackConnections: ChannelConnection[] = [];
const RECENT_CONVERSATION_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

function normalizeSkillMissing(missing: unknown): string[] {
  if (!missing) return [];
  if (Array.isArray(missing)) return missing.map((item) => String(item)).filter(Boolean);
  if (typeof missing === "object") {
    return Object.entries(missing as Record<string, unknown>)
      .filter(([, value]) => {
        if (Array.isArray(value)) return value.length > 0;
        if (value && typeof value === "object") return Object.keys(value).length > 0;
        return Boolean(value);
      })
      .map(([key]) => key);
  }
  return [String(missing)];
}

function mapGatewaySkills(result: GatewaySkillsStatusResult): Skill[] {
  return (result.skills ?? []).map((skill) => ({
    id: skill.skillKey ?? skill.name,
    name: [skill.emoji, skill.name].filter(Boolean).join(" "),
    summary: skill.description ?? "暂无技能说明。",
    description: skill.description,
    enabled: !skill.disabled,
    eligible: skill.eligible,
    missing: normalizeSkillMissing(skill.missing),
    homepage: skill.homepage,
  }));
}

function mapGatewayChannels(result: GatewayChannelsStatusResult): ChannelConnection[] {
  const ids = result.channelOrder ?? Object.keys(result.channels ?? {});
  return ids.map((id) => {
    const accounts = result.channelAccounts?.[id] ?? [];
    const connected = accounts.some((account) => account.connected || account.running);
    const configured = accounts.some((account) => account.configured || account.enabled);
    const error = accounts.find((account) => account.lastError)?.lastError;
    const status: ChannelConnection["status"] = connected ? "connected" : error ? "warning" : configured ? "warning" : "disabled";
    const label = result.channelLabels?.[id] ?? result.channelMeta?.find((item) => item.id === id)?.label ?? id;
    const detail = result.channelDetailLabels?.[id] ?? result.channelMeta?.find((item) => item.id === id)?.detailLabel ?? "OpenClaw Gateway channel";
    return {
      id,
      name: label,
      status,
      detail: error ? `${detail}：${error}` : detail,
      config: `channels.${id}`,
      activity: connected ? "运行中" : configured ? "已配置，等待连接" : "待配置",
      packageName: id === "openclaw-weixin" ? "@tencent-weixin/openclaw-weixin" : undefined,
      docsUrl: `https://docs.openclaw.ai/channels/${id}`,
      accounts: accounts.map((account) => ({
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        connected: account.connected,
        running: account.running,
        lastError: account.lastError,
      })),
    };
  });
}

function App() {
  const [bootstrapStatus, setBootstrapStatus] = useState<ClawxBootstrapStatus | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bindingInProgress, setBindingInProgress] = useState(false);
  const [agentCreateOpen, setAgentCreateOpen] = useState(false);
  const [agentCreating, setAgentCreating] = useState(false);
  const [agentCreateError, setAgentCreateError] = useState<string | null>(null);
  const [bootstrapStep, setBootstrapStep] = useState<"detect" | "install" | "bind" | "connect_test" | "ready">("detect");
  const [bootstrapConnectError, setBootstrapConnectError] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState<NavKey>("conversations");
  const [conversationSearch, setConversationSearch] = useState("");
  const [conversationSort, setConversationSort] = useState<"updated" | "tokens" | "status">("updated");
  const [agents, setAgents] = useState(agentsSeed);
  const [expandedConversationId, setExpandedConversationId] = useState("");
  const [showResourceSidebar, setShowResourceSidebar] = useState(true);
  const [skills, setSkills] = useState<Skill[]>(fallbackSkills);
  const [connections, setConnections] = useState<ChannelConnection[]>(fallbackConnections);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usage, setUsage] = useState<GatewaySessionsUsageResult | null>(null);
  const [openClawStatus, setOpenClawStatus] = useState<GatewayOpenClawStatusResult | null>(null);
  const [weixinQrDataUrl, setWeixinQrDataUrl] = useState<string | null>(null);
  const [weixinQrMessage, setWeixinQrMessage] = useState<string | null>(null);
  const [openClawInfoOpen, setOpenClawInfoOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const [composerValue, setComposerValue] = useState("");
  const { modelOptions, modelsLoading } = useModels({ enabled: bootstrapStep === "ready" });
  const { loadGatewaySnapshot } = useGatewaySnapshot();
  const [composerModel, setComposerModel] = useState("");
  const [composerThinking, setComposerThinking] = useState("off");
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [queuedMessagesByConversation, setQueuedMessagesByConversation] = useState<Record<string, QueuedComposerMessage[]>>({});
  const [sending, setSending] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const autoSendingQueuedMessageRef = useRef<string | null>(null);
  const agentsRef = useRef<Agent[]>(agentsSeed);
  const queuedMessagesByConversationRef = useRef<Record<string, QueuedComposerMessage[]>>({});
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [gatewayStatusText, setGatewayStatusText] = useState("Gateway 连接中...");
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const [userExpanded, setUserExpanded] = useState(false);

  useEffect(() => {
    queuedMessagesByConversationRef.current = queuedMessagesByConversation;
  }, [queuedMessagesByConversation]);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

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

  const refreshGatewayMetadata = useCallback(async () => {
    setMetadataLoading(true);
    try {
      await invoke("gateway_connect");
      const [skillsResult, channelsResult] = await Promise.all([
        invoke<GatewaySkillsStatusResult>("gateway_skills_status", { params: {} }),
        invoke<GatewayChannelsStatusResult>("gateway_channels_status", { params: { probe: false, timeoutMs: 2000 } }),
      ]);
      setSkills(mapGatewaySkills(skillsResult));
      setConnections(mapGatewayChannels(channelsResult));
    } catch (error) {
      console.warn("Failed to refresh Gateway metadata", error);
    } finally {
      setMetadataLoading(false);
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
    let eventCleanup: (() => void) | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

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
        const currentAgentSnapshots = agentsRef.current;
        const fallbackSnapshot = await invoke<OpenClawSnapshot>("load_openclaw_snapshot");
        if (cancelled) {
          return;
        }
        let snapshot = fallbackSnapshot;
        try {
          snapshot = await loadGatewaySnapshot({ fallbackSnapshot });
          if (cancelled) {
            return;
          }
        } catch (error) {
          console.warn("Gateway snapshot unavailable, falling back to local OpenClaw snapshot", error);
        }

        // Skip updating if there's an active run in progress to avoid overwriting runtime state
        const hasActiveRun = currentAgentSnapshots.some((agent) =>
          agent.conversations.some((conv) => conv.runtime?.activeRunId),
        );
        if (hasActiveRun) {
          return;
        }

        setAgents(buildAgentsFromSnapshot(snapshot, currentAgentSnapshots, { preserveExistingConversations: true }));
        void refreshGatewayMetadata();
      } catch (error) {
        console.error("Failed to load OpenClaw snapshot", error);
      }
    };


    // Load snapshot only once on startup
    void loadSnapshot();

    void (async () => {
      try {
        await invoke("gateway_sessions_subscribe");
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen("clawx://sessions-changed", () => {
          if (refreshTimer) {
            clearTimeout(refreshTimer);
          }
          refreshTimer = setTimeout(() => {
            void loadSnapshot();
          }, 250);
        });
        eventCleanup = () => {
          unlisten();
          void invoke("gateway_sessions_unsubscribe");
        };
        if (cancelled) {
          eventCleanup();
        }
      } catch (error) {
        console.warn("Failed to subscribe Gateway session changes", error);
      }
    })();

    return () => {
      cancelled = true;
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      eventCleanup?.();
    };
  }, [bootstrapStatus?.bindingConfigured, bootstrapStatus?.openclawInstalled, bootstrapStep, loadGatewaySnapshot, refreshGatewayMetadata]);

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

  const refreshOpenClawStatus = useCallback(async () => {
    try {
      await invoke("gateway_connect");
      const status = await invoke<GatewayOpenClawStatusResult>("gateway_openclaw_status");
      setOpenClawStatus(status);
      await refreshGatewayStatus();
    } catch (error) {
      console.warn("Failed to load OpenClaw runtime status", error);
      await refreshGatewayStatus();
    }
  }, [refreshGatewayStatus]);

  const openLocalOpenClaw = async () => {
    try {
      const dashboardUrl = await invoke<string>("resolve_dashboard_url");
      await openUrl(dashboardUrl);
    } catch (error) {
      console.error("Failed to open OpenClaw dashboard", error);
    }
  };

  const refreshUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      await invoke("gateway_connect");
      const today = new Date();
      const start = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      const formatDate = (value: Date) => value.toISOString().slice(0, 10);
      const result = await invoke<GatewaySessionsUsageResult>("gateway_sessions_usage", {
        params: {
          startDate: formatDate(start),
          endDate: formatDate(today),
          mode: "gateway",
          limit: 1000,
          includeContextWeight: true,
        },
      });
      setUsage(result);
    } catch (error) {
      console.warn("Failed to refresh usage", error);
    } finally {
      setUsageLoading(false);
    }
  }, []);

  const handleNavChange = useCallback((nav: NavKey) => {
    if (nav === activeNav) return;
    if (nav === "skills" || nav === "connections") {
      setMetadataLoading(true);
    }
    if (nav === "usage") {
      setUsageLoading(true);
    }
    setActiveNav(nav);
  }, [activeNav]);

  const handleToggleSkill = useCallback(async (skillId: string, enabled: boolean) => {
    setSkills((current) => current.map((skill) => (skill.id === skillId ? { ...skill, enabled } : skill)));
    try {
      await invoke<GatewaySkillsUpdateResult>("gateway_skills_update", {
        params: {
          skillKey: skillId,
          enabled,
        },
      });
      await refreshGatewayMetadata();
    } catch (error) {
      console.error("Failed to update skill", error);
      setSkills((current) => current.map((skill) => (skill.id === skillId ? { ...skill, enabled: !enabled } : skill)));
    }
  }, []);

  const handleWeixinLogin = useCallback(async () => {
    setWeixinQrDataUrl(null);
    setWeixinQrMessage("正在打开终端执行 openclaw channels login --channel openclaw-weixin ...");
    try {
      const message = await invoke<string>("open_weixin_login_terminal");
      setWeixinQrMessage(message);
    } catch (error) {
      setWeixinQrMessage(error instanceof Error ? error.message : String(error));
    }
  }, [refreshGatewayMetadata]);

  useEffect(() => {
    if (bootstrapStep !== "ready") {
      return;
    }
    if (activeNav === "skills" || activeNav === "connections") {
      void refreshGatewayMetadata();
    }
    if (activeNav === "usage") {
      void refreshUsage();
    }
  }, [activeNav, bootstrapStep, refreshGatewayMetadata, refreshUsage]);

  useEffect(() => {
    if (bootstrapStep !== "ready") {
      return;
    }
    void refreshOpenClawStatus();
  }, [bootstrapStep, refreshOpenClawStatus]);

  const refreshGatewaySnapshot = useCallback(async () => {
    const fallbackSnapshot = await invoke<OpenClawSnapshot>("load_openclaw_snapshot");
    const snapshot = await loadGatewaySnapshot({ fallbackSnapshot });
    setAgents(buildAgentsFromSnapshot(snapshot, agentsRef.current, { preserveExistingConversations: true }));
    await refreshGatewayMetadata();
  }, [loadGatewaySnapshot, refreshGatewayMetadata]);

  const handleCreateAgent = useCallback(async (params: { name: string; workspace: string; emoji?: string }) => {
    setAgentCreating(true);
    setAgentCreateError(null);
    try {
      await invoke("gateway_connect");
      await invoke<GatewayAgentsCreateResult>("gateway_agents_create", { params });
      await refreshGatewaySnapshot();
      setAgentCreateOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAgentCreateError(message);
    } finally {
      setAgentCreating(false);
    }
  }, [refreshGatewaySnapshot]);

  useGatewayChat({
    enabled: bootstrapStep === "ready",
    activeConversationId,
    activeRunId,
    agents,
    onAgentsChange: setAgents,
    onActiveRunIdChange: setActiveRunId,
    onSendingChange: setSending,
    onGatewayError: setGatewayError,
    onGatewayStatusTextChange: setGatewayStatusText,
    onGatewayConnectedChange: setGatewayConnected,
    refreshGatewayStatus,
  });

  const visibleConversations = useMemo(() => getVisibleConversations(agents), [agents]);

  const filteredVisibleConversations = useMemo(() => {
    const query = conversationSearch.trim().toLowerCase();
    const now = Date.now();
    const recentConversations = visibleConversations.filter((conversation) => {
      if (conversation.isDraft || conversation.status === "working") {
        return true;
      }
      return typeof conversation.updatedAt === "number" && now - conversation.updatedAt <= RECENT_CONVERSATION_WINDOW_MS;
    });
    const filtered = query
      ? recentConversations.filter((conversation) =>
          [
            conversation.title,
            conversation.id,
            conversation.agentName,
            conversation.channel,
            conversation.lastMessage,
            conversation.model,
          ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query)),
        )
      : recentConversations;

    return [...filtered].sort((left, right) => {
      if (conversationSort === "tokens") {
        return (right.totalTokens ?? 0) - (left.totalTokens ?? 0);
      }
      if (conversationSort === "status") {
        const statusRank = { working: 0, completed: 1, idle: 2 };
        const byStatus = statusRank[left.status] - statusRank[right.status];
        if (byStatus !== 0) return byStatus;
      }
      return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
    });
  }, [conversationSearch, conversationSort, visibleConversations]);

  // Always get activeConversation from agents to ensure we have the latest data
  // (including previewMessages updated by gateway_chat_history)
  const activeConversation = findConversationById(agents, activeConversationId);

  const resolveConversationDefaultModel = useCallback((conversation: Conversation | null) => {
    return resolveConversationModel(conversation, modelOptions[0]?.value ?? "");
  }, [modelOptions]);

  // Update composer model when conversation changes or previewMessages update
  useEffect(() => {
    setComposerModel(resolveConversationDefaultModel(activeConversation));
  }, [activeConversation?.id, resolveConversationDefaultModel]);

  // 创建本地草稿对话，不调用 API
  const handleCreateConversation = useCallback((agentId: string) => {
    // 检查是否已存在该 agent 的草稿对话
    const existingDraft = agents
      .find((a) => a.id === agentId)
      ?.conversations.find((c) => c.isDraft);

    if (existingDraft) {
      // 如果存在草稿，直接打开现有的
      setExpandedConversationId(existingDraft.id);
      setActiveConversationId(existingDraft.id);
      return;
    }

    const now = Date.now();
    const draftId = `draft-${agentId}-${now}`;
    const defaultModel = resolveAgentDefaultModel(agents, agentId, modelOptions);

    setAgents((current) => current.map((agent) => {
      if (agent.id !== agentId) return agent;
      const nextConversation: Conversation = {
        id: draftId,
        title: "新对话",
        status: "idle",
        lastMessage: "",
        lastTime: new Date().toLocaleString("zh-CN"),
        updatedAt: now,
        tokens: "--",
        model: defaultModel || "未配置",
        workspace: "未配置工作区",
        visible: true,
        previewMessages: [],
        isDraft: true,
        draftAgentId: agentId,
      };
      return {
        ...agent,
        conversations: [nextConversation, ...agent.conversations],
      };
    }));
    setExpandedConversationId(draftId);
    setActiveConversationId(draftId);
  }, [agents, modelOptions]);

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
        const mappedMessages = mapGatewayHistoryMessages(result);
        const lastAssistant = getLastAssistantMessage(mappedMessages);
        const { inputTokens: totalInput, outputTokens: totalOutput, cacheReadTokens: totalCacheRead, cacheWriteTokens: totalCacheWrite, totalTokens } = summarizeMessageUsage(mappedMessages);
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
    if (!activeConversationId || activeConversationId.startsWith("draft-") || bootstrapStep !== "ready") {
      return;
    }

    let cancelled = false;
    let cleanup: (() => void) | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      try {
        await invoke("gateway_session_messages_subscribe", { sessionKey: activeConversationId });
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen<RealtimeSessionMessageEvent>("clawx://session-message", (event) => {
          if (event.payload?.sessionKey !== activeConversationId) {
            return;
          }
          if (refreshTimer) {
            clearTimeout(refreshTimer);
          }
          refreshTimer = setTimeout(() => {
            void openConversationDetail(activeConversationId, true);
          }, 160);
        });
        cleanup = () => {
          unlisten();
          void invoke("gateway_session_messages_unsubscribe", { sessionKey: activeConversationId });
        };
        if (cancelled) {
          cleanup();
        }
      } catch (error) {
        console.warn("Failed to subscribe session message events", error);
      }
    })();

    return () => {
      cancelled = true;
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      cleanup?.();
    };
  }, [activeConversationId, bootstrapStep]);

  const { aiResponseScrollRef, shouldStickToBottomRef, showJumpToBottom, setShowJumpToBottom } = useConversationAutoScroll(activeConversation);

  const handleComposerFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    if (!Array.from(fileList).some((file) => file.type.startsWith("image/"))) {
      setGatewayError("当前只支持上传图片");
      return;
    }
    const next = await readImageComposerAttachments(fileList);
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

  const { sendMessageToConversation } = useMessageSender({
    agents,
    composerModel,
    composerThinking,
    activeConversationId,
    expandedConversationId,
    onAgentsChange: setAgents,
    onActiveConversationIdChange: setActiveConversationId,
    onExpandedConversationIdChange: setExpandedConversationId,
    onQueuedMessagesChange: setQueuedMessagesByConversation,
    onGatewayError: setGatewayError,
    onGatewayStatusTextChange: setGatewayStatusText,
    onSendingChange: setSending,
    onActiveRunIdChange: setActiveRunId,
    onComposerValueChange: setComposerValue,
    onComposerAttachmentsChange: setComposerAttachments,
    refreshGatewayStatus,
  });

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




  const bootstrapScreen = (
    <BootstrapScreens
      bootstrapLoading={bootstrapLoading}
      bootstrapError={bootstrapError}
      bootstrapStatus={bootstrapStatus}
      bootstrapStep={bootstrapStep}
      bootstrapConnectError={bootstrapConnectError}
      bindingInProgress={bindingInProgress}
      onLoadBootstrapStatus={() => void loadBootstrapStatus()}
      onBindOpenClaw={() => void bindOpenClaw()}
      onSetBootstrapStep={setBootstrapStep}
    />
  );

  if (bootstrapScreen) {
    const shouldShowBootstrap = bootstrapLoading
      || Boolean(bootstrapError)
      || !bootstrapStatus?.openclawInstalled
      || !bootstrapStatus?.bindingConfigured
      || bootstrapStep === "connect_test"
      || Boolean(bootstrapConnectError);
    if (shouldShowBootstrap) return bootstrapScreen;
  }

  return (
    <main className="app-shell">
      <GatewayBanner connected={gatewayConnected} statusText={gatewayStatusText} error={gatewayError} />
      <ImageLightbox src={previewImageSrc} onClose={() => setPreviewImageSrc(null)} />
      <AgentCreateDialog
        open={agentCreateOpen}
        creating={agentCreating}
        error={agentCreateError}
        onClose={() => {
          if (agentCreating) return;
          setAgentCreateOpen(false);
          setAgentCreateError(null);
        }}
        onCreate={handleCreateAgent}
      />
      <div
        className={`layout no-topbar ${
          activeNav === "conversations"
            ? showResourceSidebar
              ? "with-resource-sidebar"
              : "without-resource-sidebar"
            : "content-only"
        }`}
      >
        <NavSidebar
          activeNav={activeNav}
          onNavChange={handleNavChange}
          onOpenLocalOpenClaw={() => void openLocalOpenClaw()}
          gatewayConnected={gatewayConnected}
          gatewayVersion={openClawStatus?.runtimeVersion}
          sessionCount={openClawStatus?.sessions?.count}
          onReconnect={() => void refreshOpenClawStatus()}
          onOpenStatus={() => {
            setOpenClawInfoOpen(true);
            void refreshOpenClawStatus();
          }}
        />

        {activeNav === "conversations" ? (
          <>
            <ResourceSidebar
              agents={agents}
              expandedConversationId={expandedConversationId}
              visible={showResourceSidebar}
              onCreateAgent={() => setAgentCreateOpen(true)}
              onCreateConversation={(agentId) => void handleCreateConversation(agentId)}
              onToggleConversationVisibility={toggleConversationVisibility}
              onExpandedConversationChange={setExpandedConversationId}
              onOpenConversation={openConversationDetail}
              onCollapse={() => setShowResourceSidebar(false)}
              onExpand={() => setShowResourceSidebar(true)}
            />

            <ConversationWorkspace
              activeConversation={activeConversation}
              visibleConversations={visibleConversations}
              filteredVisibleConversations={filteredVisibleConversations}
              conversationSearch={conversationSearch}
              conversationSort={conversationSort}
              statusLabel={statusLabel}
              userExpanded={userExpanded}
              aiResponseScrollRef={aiResponseScrollRef}
              showJumpToBottom={showJumpToBottom}
              shouldStickToBottomRef={shouldStickToBottomRef}
              composerFocused={composerFocused}
              composerValue={composerValue}
              composerModel={composerModel}
              composerThinking={composerThinking}
              sending={sending}
              composerAttachments={composerAttachments}
              activeQueuedMessages={activeQueuedMessages}
              modelOptions={modelOptions}
              modelsLoading={modelsLoading}
              onBack={() => setActiveConversationId(null)}
              onUserExpandedChange={setUserExpanded}
              onJumpToBottomHidden={() => setShowJumpToBottom(false)}
              onUpdateTitle={async (conversationId, newTitle) => {
                let isDraftConversation = false;
                setAgents((current) => current.map((agent) => ({
                  ...agent,
                  conversations: agent.conversations.map((conversation) => {
                    if (conversation.id === conversationId) {
                      isDraftConversation = conversation.isDraft ?? false;
                      return { ...conversation, title: newTitle };
                    }
                    return conversation;
                  }),
                })));
                if (!isDraftConversation) {
                  try {
                    await invoke("gateway_sessions_patch", {
                      params: {
                        sessionKey: conversationId,
                        label: newTitle,
                      },
                    });
                  } catch (error) {
                    console.error("更新 session title 失败:", error);
                  }
                }
              }}
              parseSenderMeta={parseSenderMeta}
              onOpenImage={setPreviewImageSrc}
              formatTokenCount={formatTokenCount}
              onOpenConversation={openConversationDetail}
              onHideConversation={(agentId, conversationId) => toggleConversationVisibility(agentId, conversationId, false)}
              onConversationSearchChange={setConversationSearch}
              onConversationSortChange={setConversationSort}
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
        ) : null}

        {activeNav === "skills" ? (
          <SkillsPage
            skills={skills}
            loading={metadataLoading}
            onToggleSkill={(skillId, enabled) => void handleToggleSkill(skillId, enabled)}
          />
        ) : null}

        {activeNav === "connections" ? (
          <ConnectionsPage
            connections={connections}
            connectionLabel={connectionLabel}
            loading={metadataLoading}
            qrDataUrl={weixinQrDataUrl}
            qrMessage={weixinQrMessage}
            onWeixinLogin={() => void handleWeixinLogin()}
          />
        ) : null}

        {activeNav === "usage" ? (
          <UsagePage usage={usage} loading={usageLoading} />
        ) : null}
      </div>

      {openClawInfoOpen ? (
        <aside className="openclaw-info-drawer" role="dialog" aria-modal="true">
          <div className="openclaw-info-head">
            <img src="/openclaw-logo-text.svg" alt="OpenClaw" />
            <button className="icon-only-button" type="button" onClick={() => setOpenClawInfoOpen(false)} title="关闭">×</button>
          </div>
          <div className="openclaw-info-status">
            <span className={`status-dot ${gatewayConnected ? "working" : "completed"}`} />
            <strong>{gatewayConnected ? "已连接" : "未连接"}</strong>
            <span>{gatewayStatusText}</span>
          </div>
          <div className="openclaw-info-grid">
            <span>版本</span><strong>{openClawStatus?.runtimeVersion || "-"}</strong>
            <span>会话</span><strong>{openClawStatus?.sessions?.count ?? "-"}</strong>
            <span>默认模型</span><strong>{openClawStatus?.sessions?.defaults?.model || "-"}</strong>
            <span>默认 Agent</span><strong>{openClawStatus?.heartbeat?.defaultAgentId || "-"}</strong>
          </div>
          {openClawStatus?.channelSummary?.length ? (
            <div className="openclaw-info-list">
              <strong>连接摘要</strong>
              {openClawStatus.channelSummary.slice(0, 8).map((item, index) => (
                <span key={`${item}-${index}`}>{item}</span>
              ))}
            </div>
          ) : null}
          <div className="openclaw-info-actions">
            <button className="ghost-button" type="button" onClick={() => void refreshOpenClawStatus()}>重连</button>
            <button className="primary-action-button" type="button" onClick={() => void openLocalOpenClaw()}>打开 OpenClaw</button>
          </div>
        </aside>
      ) : null}
    </main>
  );
}

export default App;
