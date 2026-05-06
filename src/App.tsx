import { startTransition, useEffect, useMemo, useState, useCallback, useRef } from "react";
import { defaultWindowIcon } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GatewayBanner, ImageLightbox, NavSidebar } from "./components/AppChrome";
import { AgentCreateDialog } from "./components/AgentCreateDialog";
import { AgentFilesDialog } from "./components/AgentFilesDialog";
import { BootstrapScreens } from "./components/BootstrapScreens";
import { ConversationWorkspace } from "./components/ConversationWorkspace";
import { ConnectionsPage, SkillsPage, UsagePage } from "./components/InfoPages";
import { ModelsPage } from "./components/ModelsPage";
import { ResourceSidebar } from "./components/ResourceSidebar";
import { getLastAssistantMessage, mapGatewayHistoryMessages, resolveConversationDefaultModel as resolveConversationModel, summarizeMessageUsage } from "./lib/conversationHistory";
import { findConversationById, getVisibleConversations } from "./lib/conversationSelectors";
import { readComposerAttachments } from "./lib/composerAttachments";
import { useConversationAutoScroll } from "./hooks/useConversationAutoScroll";
import { useGatewayChat } from "./hooks/useGatewayChat";
import { useGatewaySnapshot } from "./hooks/useGatewaySnapshot";
import { useMessageSender } from "./hooks/useMessageSender";
import { useModels } from "./hooks/useModels";
import { buildAgentsFromSnapshot, hasActiveAgentRun, patchConversation, resolveAgentDefaultModel } from "./lib/agentsSnapshot";
import { connectionLabel, formatTokenCount, statusLabel } from "./lib/appFormatters";
import { parseSenderMeta } from "./lib/messageMeta";
import { mergeSnapshotMessagesPreservingCurrentOrder } from "./lib/toolStream";
import { isInternalOpenClawMessage } from "./lib/gatewayMessages";
import type { Conversation, ConversationRuntime, PreviewMessage } from "./types/conversation";
import type { Agent, ChannelConnection, ClawxBootstrapStatus, ComposerAttachment, NavKey, OpenClawCliStatus, QueuedComposerMessage, Skill, WeixinPluginStatus } from "./types/app";
import type { GatewayAgentsCreateResult, GatewayAgentsUpdateResult, GatewayChannelsStatusResult, GatewayConfigGetResult, GatewayConfigPatchResult, GatewayHistoryResult, GatewayModelAuthStatusResult, GatewayModelSummary, GatewayModelsResult, GatewayOpenClawStatusResult, GatewaySessionsUsageResult, GatewaySkillsStatusResult, GatewaySkillsUpdateResult, GatewayStatus, OpenClawSnapshot } from "./types/gateway";
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
  const [agentFilesAgentId, setAgentFilesAgentId] = useState<string | null>(null);
  const [bootstrapStep, setBootstrapStep] = useState<"detect" | "install" | "bind" | "connect_test" | "ready">("detect");
  const [bootstrapConnectError, setBootstrapConnectError] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState<NavKey>("conversations");
  const [conversationSearch, setConversationSearch] = useState("");
  const [conversationRuntimeFilter, setConversationRuntimeFilter] = useState("all");
  const [conversationSort, setConversationSort] = useState<"updated" | "tokens" | "status">("updated");
  const [openedConversationIds, setOpenedConversationIds] = useState<Record<string, true>>({});
  const [agents, setAgents] = useState(agentsSeed);
  const [expandedConversationId, setExpandedConversationId] = useState("");
  const [showResourceSidebar, setShowResourceSidebar] = useState(true);
  const [skills, setSkills] = useState<Skill[]>(fallbackSkills);
  const [connections, setConnections] = useState<ChannelConnection[]>(fallbackConnections);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataPageReady, setMetadataPageReady] = useState(true);
  const [weixinStatus, setWeixinStatus] = useState<WeixinPluginStatus | null>(null);
  const [weixinBusy, setWeixinBusy] = useState(false);
  const [weixinMessage, setWeixinMessage] = useState<string | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usage, setUsage] = useState<GatewaySessionsUsageResult | null>(null);
  const [usagePageReady, setUsagePageReady] = useState(true);
  const [modelsPageLoading, setModelsPageLoading] = useState(false);
  const [modelActionBusy, setModelActionBusy] = useState(false);
  const [modelsActionMessage, setModelsActionMessage] = useState<string | null>(null);
  const [configuredModels, setConfiguredModels] = useState<GatewayModelSummary[]>([]);
  const [allModels, setAllModels] = useState<GatewayModelSummary[]>([]);
  const [modelAuthStatus, setModelAuthStatus] = useState<GatewayModelAuthStatusResult | null>(null);
  const [modelsPageReady, setModelsPageReady] = useState(false);
  const [openClawStatus, setOpenClawStatus] = useState<GatewayOpenClawStatusResult | null>(null);
  const [openClawCliStatus, setOpenClawCliStatus] = useState<OpenClawCliStatus | null>(null);
  const [openClawUpdateBusy, setOpenClawUpdateBusy] = useState(false);
  const [openClawUpdateMessage, setOpenClawUpdateMessage] = useState<string | null>(null);
  const [openClawGatewayBusy, setOpenClawGatewayBusy] = useState(false);
  const [openClawGatewayMessage, setOpenClawGatewayMessage] = useState<string | null>(null);
  const [openClawInfoOpen, setOpenClawInfoOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const [composerValue, setComposerValue] = useState("");
  const { modelOptions, modelsLoading, reloadModels } = useModels({ enabled: bootstrapStep === "ready" });
  const { loadGatewaySnapshot } = useGatewaySnapshot();
  const [composerModel, setComposerModel] = useState("");
  const [composerThinking, setComposerThinking] = useState("off");
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [queuedMessagesByConversation, setQueuedMessagesByConversation] = useState<Record<string, QueuedComposerMessage[]>>({});
  const [sendErrorsByConversation, setSendErrorsByConversation] = useState<Record<string, string>>({});
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
    let cancelled = false;

    async function applyWindowIcon() {
      try {
        const icon = await defaultWindowIcon();
        if (!cancelled && icon) {
          await getCurrentWindow().setIcon(icon);
        }
      } catch (error) {
        console.warn("Failed to apply Clawx window icon", error);
      }
    }

    void applyWindowIcon();

    return () => {
      cancelled = true;
    };
  }, []);

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

  const refreshWeixinPluginStatus = useCallback(async () => {
    setWeixinBusy(true);
    try {
      const status = await invoke<WeixinPluginStatus>("weixin_plugin_status");
      setWeixinStatus(status);
    } catch (error) {
      console.warn("Failed to refresh WeChat plugin status", error);
      setWeixinMessage(error instanceof Error ? error.message : "WeChat 插件状态检测失败");
    } finally {
      setWeixinBusy(false);
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

  const refreshGatewayConnections = useCallback(async () => {
    setMetadataLoading(true);
    try {
      await invoke("gateway_connect");
      const channelsResult = await invoke<GatewayChannelsStatusResult>("gateway_channels_status", {
        params: { probe: false, timeoutMs: 2000 },
      });
      setConnections(mapGatewayChannels(channelsResult));
    } catch (error) {
      console.warn("Failed to refresh Gateway connections", error);
    } finally {
      setMetadataLoading(false);
    }
  }, []);

  const ensureWeixinPluginEnabled = useCallback(async () => {
    setWeixinBusy(true);
    setWeixinMessage(null);
    try {
      const message = await invoke<string>("ensure_weixin_plugin_enabled");
      setWeixinMessage(message);
      await refreshWeixinPluginStatus();
      await refreshGatewayMetadata();
    } catch (error) {
      console.error("Failed to enable WeChat plugin", error);
      setWeixinMessage(error instanceof Error ? error.message : "WeChat 插件启用失败");
    } finally {
      setWeixinBusy(false);
    }
  }, [refreshGatewayMetadata, refreshWeixinPluginStatus]);

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
        if (hasActiveAgentRun(currentAgentSnapshots)) {
          return;
        }
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
          if (hasActiveAgentRun(agentsRef.current)) {
            return;
          }
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
                const isFailedSnapshot = ["error", "failed", "timeout"].includes(nextLatestEventType ?? "");
                const isStoppedSnapshot = ["aborted", "cancelled", "killed", "interrupted"].includes(nextLatestEventType ?? "");
                const isCompletedSnapshot = ["turn_completed", "completed", "final", "done"].includes(nextLatestEventType ?? "");
                const isActiveSnapshot = ["running", "started", "tool_stream", "assistant_stream", "delta", "tool_call", "tool_result"].includes(nextLatestEventType ?? "");
                const isTerminalSnapshot = isCompletedSnapshot || isFailedSnapshot || isStoppedSnapshot;
                const isFreshActiveSnapshot = isActiveSnapshot && Boolean(nextUpdatedAt) && Date.now() - Number(nextUpdatedAt) <= 6 * 60 * 60 * 1000;
                const terminalReason: ConversationRuntime["lastTerminalReason"] = isFailedSnapshot
                  ? (nextLatestEventType === "timeout" ? "timeout" : "failed")
                  : isStoppedSnapshot
                    ? (nextLatestEventType === "killed" ? "killed" : nextLatestEventType === "cancelled" ? "cancelled" : "aborted")
                    : "completed";
                const nextRuntime = latestIsToolOnly && isFreshActiveSnapshot && !isTerminalSnapshot
                  ? {
                      ...conversation.runtime,
                      activeRunId: conversation.runtime?.activeRunId ?? `snapshot-tool-${payload.session.key}`,
                      activeStartedAt: conversation.runtime?.activeStartedAt ?? nextUpdatedAt ?? Date.now(),
                      lastEventAt: nextUpdatedAt,
                    }
                  : isTerminalSnapshot
                    ? {
                        ...conversation.runtime,
                        activeRunId: undefined,
                        activeStartedAt: undefined,
                        lastEventAt: nextUpdatedAt,
                        lastTerminalAt: nextUpdatedAt,
                        lastTerminalReason: terminalReason,
                      }
                    : isActiveSnapshot && !isFreshActiveSnapshot
                      ? {
                          ...conversation.runtime,
                          activeRunId: undefined,
                          activeStartedAt: undefined,
                          lastEventAt: nextUpdatedAt,
                          lastTerminalAt: conversation.runtime?.lastTerminalAt ?? nextUpdatedAt,
                          lastTerminalReason: conversation.runtime?.lastTerminalReason ?? "interrupted",
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
                  // Gateway session_patch often carries only a recent preview window. Replacing the full
                  // list would drop earlier turns (e.g. after a run ends and activeRunId clears). Always merge.
                  previewMessages: mergeSnapshotMessagesPreservingCurrentOrder(
                    currentConversation.previewMessages ?? [],
                    nextPreviewMessages,
                  ),
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

  const refreshModelsPage = useCallback(async (options?: { refreshAuth?: boolean }) => {
    setModelsPageLoading(true);
    try {
      await invoke("gateway_connect");
      const [configuredResult, authResult] = await Promise.all([
        invoke<GatewayModelsResult>("gateway_models_list", { params: { view: "configured" } }),
        invoke<GatewayModelAuthStatusResult>("gateway_models_auth_status", { params: { refresh: Boolean(options?.refreshAuth) } }),
      ]);
      startTransition(() => {
        setConfiguredModels(configuredResult.models ?? []);
        setModelAuthStatus(authResult);
      });
      setModelsPageLoading(false);
      void reloadModels();
      void (async () => {
        try {
          const allResult = await invoke<GatewayModelsResult>("gateway_models_list", { params: { view: "all" } });
          startTransition(() => setAllModels(allResult.models ?? []));
        } catch (error) {
          console.warn("Failed to refresh full model catalog", error);
        }
      })();
    } catch (error) {
      console.warn("Failed to refresh models page", error);
      setModelsActionMessage(error instanceof Error ? error.message : "模型状态刷新失败");
      setModelsPageLoading(false);
    }
  }, [reloadModels]);

  const patchOpenClawConfig = useCallback(async (patch: unknown) => {
    const current = await invoke<GatewayConfigGetResult>("gateway_config_get");
    if (!current.hash) {
      throw new Error("OpenClaw 配置 hash 不可用，请刷新后重试");
    }
    await invoke<GatewayConfigPatchResult>("gateway_config_patch", {
      params: {
        raw: JSON.stringify(patch),
        baseHash: current.hash,
        restartDelayMs: 300,
      },
    });
  }, []);

  const handleSetDefaultModel = useCallback(async (modelRef: string) => {
    setModelActionBusy(true);
    setModelsActionMessage(null);
    try {
      await patchOpenClawConfig({ agents: { defaults: { model: { primary: modelRef }, models: { [modelRef]: {} } } } });
      setModelsActionMessage(`已设为默认模型：${modelRef}`);
      setComposerModel(modelRef);
      setOpenClawStatus((current) => current ? {
        ...current,
        sessions: {
          ...current.sessions,
          defaults: {
            ...current.sessions?.defaults,
            model: modelRef,
          },
        },
      } : current);
      void refreshOpenClawStatus();
      void refreshModelsPage({ refreshAuth: true });
    } catch (error) {
      console.error("Failed to set default model", error);
      setModelsActionMessage(error instanceof Error ? error.message : "设置默认模型失败");
    } finally {
      setModelActionBusy(false);
    }
  }, [patchOpenClawConfig, refreshModelsPage, refreshOpenClawStatus]);

  const handleModelAuthProvider = useCallback(async (provider: string, setDefault: boolean) => {
    setModelActionBusy(true);
    setModelsActionMessage(null);
    try {
      const message = await invoke<string>("open_model_auth_terminal", { provider, setDefault });
      setModelsActionMessage(message);
      window.setTimeout(() => void refreshModelsPage({ refreshAuth: true }), 1500);
    } catch (error) {
      console.error("Failed to open model auth terminal", error);
      setModelsActionMessage(error instanceof Error ? error.message : "打开模型授权失败");
    } finally {
      setModelActionBusy(false);
    }
  }, [refreshModelsPage]);

  const handleSaveProviderConfig = useCallback(async (draft: { provider: string; apiKey: string; baseUrl: string }) => {
    const provider = draft.provider.trim();
    if (!provider) {
      setModelsActionMessage("Provider 不能为空");
      return;
    }
    const providerConfig: Record<string, unknown> = {};
    if (draft.apiKey.trim()) providerConfig.apiKey = draft.apiKey.trim();
    if (draft.baseUrl.trim()) providerConfig.baseUrl = draft.baseUrl.trim();
    if (Object.keys(providerConfig).length === 0) {
      setModelsActionMessage("请填写 API Key 或 Base URL");
      return;
    }
    setModelActionBusy(true);
    setModelsActionMessage(null);
    try {
      await patchOpenClawConfig({ models: { providers: { [provider]: providerConfig } } });
      setModelsActionMessage(`已保存 Provider：${provider}`);
      void refreshModelsPage({ refreshAuth: true });
    } catch (error) {
      console.error("Failed to save provider config", error);
      setModelsActionMessage(error instanceof Error ? error.message : "保存 Provider 配置失败");
    } finally {
      setModelActionBusy(false);
    }
  }, [patchOpenClawConfig, refreshModelsPage]);

  const handleSaveModelConfig = useCallback(async (draft: { provider: string; modelId: string; alias: string; setDefault: boolean }) => {
    const provider = draft.provider.trim();
    const modelId = draft.modelId.trim();
    if (!provider || !modelId) {
      setModelsActionMessage("Provider 和模型名称不能为空");
      return;
    }
    const modelRef = `${provider}/${modelId}`;
    const patch: Record<string, unknown> = {
      models: { providers: { [provider]: { models: [{ id: modelId, ...(draft.alias.trim() ? { name: draft.alias.trim() } : {}) }] } } },
      agents: {
        defaults: {
          models: { [modelRef]: draft.alias.trim() ? { alias: draft.alias.trim() } : {} },
          ...(draft.setDefault ? { model: { primary: modelRef } } : {}),
        },
      },
    };

    setModelActionBusy(true);
    setModelsActionMessage(null);
    try {
      await patchOpenClawConfig(patch);
      if (draft.setDefault) {
        setComposerModel(modelRef);
        setOpenClawStatus((current) => current ? {
          ...current,
          sessions: {
            ...current.sessions,
            defaults: {
              ...current.sessions?.defaults,
              model: modelRef,
            },
          },
        } : current);
      }
      setModelsActionMessage(draft.setDefault ? `已保存并设为默认：${modelRef}` : `已保存模型：${modelRef}`);
      void refreshOpenClawStatus();
      void refreshModelsPage({ refreshAuth: true });
    } catch (error) {
      console.error("Failed to save provider model config", error);
      setModelsActionMessage(error instanceof Error ? error.message : "保存模型配置失败");
    } finally {
      setModelActionBusy(false);
    }
  }, [patchOpenClawConfig, refreshModelsPage, refreshOpenClawStatus]);

  const refreshOpenClawCliStatus = useCallback(async () => {
    try {
      const status = await invoke<OpenClawCliStatus>("openclaw_cli_status");
      setOpenClawCliStatus(status);
    } catch (error) {
      console.warn("Failed to load OpenClaw CLI version status", error);
    }
  }, []);

  const runOpenClawUpdate = useCallback(async () => {
    setOpenClawUpdateBusy(true);
    setOpenClawUpdateMessage(null);
    try {
      const message = await invoke<string>("open_openclaw_update_terminal");
      setOpenClawUpdateMessage(message);
      window.setTimeout(() => {
        void refreshOpenClawCliStatus();
        void refreshOpenClawStatus();
      }, 1500);
    } catch (error) {
      console.error("Failed to open OpenClaw update terminal", error);
      setOpenClawUpdateMessage(error instanceof Error ? error.message : "OpenClaw 更新失败");
    } finally {
      setOpenClawUpdateBusy(false);
    }
  }, [refreshOpenClawCliStatus, refreshOpenClawStatus]);

  const toggleOpenClawGateway = useCallback(async () => {
    if (openClawGatewayBusy) return;
    const shouldStop = gatewayConnected;
    setOpenClawGatewayBusy(true);
    setOpenClawGatewayMessage(null);
    try {
      const message = await invoke<string>(shouldStop ? "openclaw_gateway_stop" : "openclaw_gateway_start");
      setOpenClawGatewayMessage(message || (shouldStop ? "OpenClaw Gateway 已停止。" : "OpenClaw Gateway 已启动。"));
      if (shouldStop) {
        setGatewayConnected(false);
        setGatewayStatusText("OpenClaw Gateway 已停止");
        setOpenClawStatus(null);
      }
      window.setTimeout(() => void refreshOpenClawStatus(), shouldStop ? 900 : 1200);
    } catch (error) {
      console.error(`Failed to ${shouldStop ? "stop" : "start"} OpenClaw Gateway`, error);
      setOpenClawGatewayMessage(error instanceof Error ? error.message : (shouldStop ? "停止 OpenClaw 失败" : "启动 OpenClaw 失败"));
      void refreshOpenClawStatus();
    } finally {
      setOpenClawGatewayBusy(false);
    }
  }, [gatewayConnected, openClawGatewayBusy, refreshOpenClawStatus]);

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
    if (nav === "usage") {
      setUsageLoading(true);
      setUsagePageReady(false);
      window.requestAnimationFrame(() => {
        window.setTimeout(() => setUsagePageReady(true), 0);
      });
    }
    if (nav === "skills" || nav === "connections") {
      setMetadataLoading(true);
      setMetadataPageReady(false);
      window.requestAnimationFrame(() => {
        window.setTimeout(() => setMetadataPageReady(true), 0);
      });
    }
    if (nav === "models") {
      setModelsPageLoading(true);
      setModelsPageReady(false);
      window.requestAnimationFrame(() => {
        window.setTimeout(() => setModelsPageReady(true), 0);
      });
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

  const toggleOpenClawInfo = useCallback(() => {
    setOpenClawInfoOpen((current) => !current);
    if (!openClawInfoOpen) {
      void refreshOpenClawStatus();
      void refreshOpenClawCliStatus();
    }
  }, [openClawInfoOpen, refreshOpenClawCliStatus, refreshOpenClawStatus]);

  useEffect(() => {
    if (bootstrapStep !== "ready") {
      return;
    }
    let cancelled = false;
    const timeouts: Array<ReturnType<typeof setTimeout>> = [];
    const frames: number[] = [];

    const scheduleAfterPaint = (task: () => void, delay = 0) => {
      const frame = window.requestAnimationFrame(() => {
        const timeout = setTimeout(() => {
          if (!cancelled) {
            task();
          }
        }, delay);
        timeouts.push(timeout);
      });
      frames.push(frame);
    };

    if (activeNav === "skills") {
      scheduleAfterPaint(() => {
        setMetadataPageReady(true);
        void refreshGatewayMetadata();
      }, 80);
    }
    if (activeNav === "connections") {
      scheduleAfterPaint(() => {
        setMetadataPageReady(true);
        void refreshGatewayConnections();
      }, 80);
      scheduleAfterPaint(() => void refreshWeixinPluginStatus(), 430);
    }
    if (activeNav === "models") {
      scheduleAfterPaint(() => {
        setModelsPageReady(true);
        void refreshModelsPage({ refreshAuth: true });
      }, 80);
    }
    if (activeNav === "usage") {
      scheduleAfterPaint(() => {
        setUsagePageReady(true);
        void refreshUsage();
      }, 80);
    }
    return () => {
      cancelled = true;
      frames.forEach((frame) => window.cancelAnimationFrame(frame));
      timeouts.forEach((timeout) => clearTimeout(timeout));
    };
  }, [activeNav, bootstrapStep, refreshGatewayConnections, refreshGatewayMetadata, refreshModelsPage, refreshUsage, refreshWeixinPluginStatus]);

  useEffect(() => {
    if (bootstrapStep !== "ready") {
      return;
    }
    void refreshOpenClawStatus();
    void refreshOpenClawCliStatus();
  }, [bootstrapStep, refreshOpenClawCliStatus, refreshOpenClawStatus]);

  const refreshGatewaySnapshot = useCallback(async (options?: { priorityAgentId?: string }) => {
    const fallbackSnapshot = await invoke<OpenClawSnapshot>("load_openclaw_snapshot");
    const snapshot = await loadGatewaySnapshot({ fallbackSnapshot });
    setAgents(buildAgentsFromSnapshot(snapshot, agentsRef.current, {
      preserveExistingConversations: true,
      priorityAgentId: options?.priorityAgentId,
    }));
    await refreshGatewayMetadata();
  }, [loadGatewaySnapshot, refreshGatewayMetadata]);

  const runWeixinTerminalAction = useCallback(async (command: "open_weixin_plugin_install_terminal" | "open_weixin_plugin_update_terminal" | "open_weixin_login_terminal") => {
    setWeixinBusy(true);
    setWeixinMessage(null);
    try {
      const message = await invoke<string>(command);
      setWeixinMessage(message);
      if (command !== "open_weixin_login_terminal") {
        window.setTimeout(() => {
          void refreshWeixinPluginStatus();
          void refreshGatewayMetadata();
        }, 1500);
      }
    } catch (error) {
      console.error(`Failed to run ${command}`, error);
      setWeixinMessage(error instanceof Error ? error.message : "WeChat 操作失败");
    } finally {
      setWeixinBusy(false);
    }
  }, [refreshGatewayMetadata, refreshWeixinPluginStatus]);

  const handleCreateAgent = useCallback(async (params: { agentId: string; name: string; workspace: string; emoji?: string }) => {
    setAgentCreating(true);
    setAgentCreateError(null);
    try {
      await invoke("gateway_connect");
      const result = await invoke<GatewayAgentsCreateResult>("gateway_agents_create", {
        params: {
          name: params.agentId,
          workspace: params.workspace,
          emoji: params.emoji,
        },
      });
      if (params.name.trim() && params.name.trim() !== result.name) {
        await invoke<GatewayAgentsUpdateResult>("gateway_agents_update", {
          params: { agentId: result.agentId, name: params.name.trim() },
        });
      }
      await refreshGatewaySnapshot({ priorityAgentId: result.agentId });
      setAgentCreateOpen(false);
      setAgentFilesAgentId(result.agentId);
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
    onAgentsChange: setAgents,
    onActiveRunIdChange: setActiveRunId,
    onSendingChange: setSending,
    onGatewayError: setGatewayError,
    onGatewayStatusTextChange: setGatewayStatusText,
    onGatewayConnectedChange: setGatewayConnected,
    refreshGatewayStatus,
  });

  const visibleConversations = useMemo(() => getVisibleConversations(agents), [agents]);

  const conversationRuntimeOptions = useMemo(() => {
    const runtimeById = new Map<string, { value: string; label: string; count: number }>();
    for (const conversation of visibleConversations) {
      const runtime = conversation.agentRuntime;
      if (!runtime?.id) continue;
      const existing = runtimeById.get(runtime.id);
      if (existing) {
        existing.count += 1;
      } else {
        runtimeById.set(runtime.id, {
          value: runtime.id,
          label: runtime.label ?? runtime.id,
          count: 1,
        });
      }
    }
    return [...runtimeById.values()].sort((left, right) => left.label.localeCompare(right.label));
  }, [visibleConversations]);

  const filteredVisibleConversations = useMemo(() => {
    const query = conversationSearch.trim().toLowerCase();
    const now = Date.now();
    const selectedConversationIds = new Set([activeConversationId, expandedConversationId].filter(Boolean));
    const recentConversations = visibleConversations.filter((conversation) => {
      if (selectedConversationIds.has(conversation.id) || openedConversationIds[conversation.id]) {
        return true;
      }
      if (conversation.isDraft || conversation.status === "working") {
        return true;
      }
      return typeof conversation.updatedAt === "number" && now - conversation.updatedAt <= RECENT_CONVERSATION_WINDOW_MS;
    });
    const runtimeFiltered = conversationRuntimeFilter === "all"
      ? recentConversations
      : recentConversations.filter((conversation) => conversation.agentRuntime?.id === conversationRuntimeFilter);
    const filtered = query
      ? runtimeFiltered.filter((conversation) =>
          [
            conversation.title,
            conversation.id,
            conversation.agentName,
            conversation.channel,
            conversation.lastMessage,
            conversation.model,
            conversation.agentRuntime?.id,
            conversation.agentRuntime?.label,
            conversation.agentRuntime?.source,
          ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query)),
        )
      : runtimeFiltered;

    return [...filtered].sort((left, right) => {
      if (conversationSort === "tokens") {
        return (right.totalTokens ?? 0) - (left.totalTokens ?? 0);
      }
      if (conversationSort === "status") {
        const statusRank = { working: 0, failed: 1, stopped: 2, completed: 3, idle: 4 };
        const byStatus = statusRank[left.status] - statusRank[right.status];
        if (byStatus !== 0) return byStatus;
      }
      return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
    });
  }, [activeConversationId, conversationRuntimeFilter, conversationSearch, conversationSort, expandedConversationId, openedConversationIds, visibleConversations]);

  // Always get activeConversation from agents to ensure we have the latest data
  // (including previewMessages updated by gateway_chat_history)
  const activeConversation = findConversationById(agents, activeConversationId);
  const activeConversationRef = useRef<Conversation | null>(null);

  useEffect(() => {
    activeConversationRef.current = activeConversation;
  }, [activeConversation]);

  const resolveConversationDefaultModel = useCallback((conversation: Conversation | null) => {
    return resolveConversationModel(conversation, modelOptions[0]?.value ?? "");
  }, [modelOptions]);

  const resolveConversationDefaultThinking = useCallback((conversation: Conversation | null) => {
    const options = conversation?.thinkingOptions ?? [];
    if (options.length === 0 || options.some((option) => option.value === "off")) {
      return "off";
    }
    return options[0]?.value ?? "off";
  }, []);

  // Update composer model when conversation changes or previewMessages update
  useEffect(() => {
    setComposerModel(resolveConversationDefaultModel(activeConversation));
  }, [activeConversation?.id, resolveConversationDefaultModel]);

  useEffect(() => {
    setComposerThinking(resolveConversationDefaultThinking(activeConversation));
  }, [activeConversation?.id, activeConversation?.thinkingDefault, activeConversation?.thinkingOptions, resolveConversationDefaultThinking]);

  // 创建本地草稿对话，不调用 API
  const handleCreateConversation = useCallback((agentId: string) => {
    // 检查是否已存在该 agent 的草稿对话
    const existingDraft = agents
      .find((a) => a.id === agentId)
      ?.conversations.find((c) => c.isDraft);

    if (existingDraft) {
      // 如果存在草稿，直接打开现有的
      setOpenedConversationIds((current) => ({ ...current, [existingDraft.id]: true }));
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
        thinkingDefault: "off",
        thinkingOptions: [{ value: "off", label: "off" }],
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
    setOpenedConversationIds((current) => ({ ...current, [draftId]: true }));
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
      setOpenedConversationIds((current) => ({ ...current, [conversationId]: true }));
      setExpandedConversationId(conversationId);
    } else if (expandedConversationId === conversationId) {
      setOpenedConversationIds((current) => {
        const next = { ...current };
        delete next[conversationId];
        return next;
      });
      setExpandedConversationId("");
    } else {
      setOpenedConversationIds((current) => {
        const next = { ...current };
        delete next[conversationId];
        return next;
      });
    }
  };

  const openConversationDetail = async (conversationId: string, preserveStatus = false) => {
    setOpenedConversationIds((current) => ({ ...current, [conversationId]: true }));
    setExpandedConversationId(conversationId);
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
              // Session events can trigger refresh after a run ends; chat.history may return only a recent
              // window. Always merge so we never replace a longer local thread with a shorter RPC result.
              return {
                ...conversation,
                previewMessages: mergeSnapshotMessagesPreservingCurrentOrder(
                  conversation.previewMessages ?? [],
                  mappedMessages,
                ),
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

  const openConversationDetailRef = useRef(openConversationDetail);

  useEffect(() => {
    openConversationDetailRef.current = openConversationDetail;
  }, [openConversationDetail]);

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
          if (activeConversationRef.current?.id === activeConversationId && activeConversationRef.current.runtime?.activeRunId) {
            return;
          }
          if (refreshTimer) {
            clearTimeout(refreshTimer);
          }
          refreshTimer = setTimeout(() => {
            if (activeConversationRef.current?.id === activeConversationId && activeConversationRef.current.runtime?.activeRunId) {
              return;
            }
            void openConversationDetailRef.current(activeConversationId, true);
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
    const next = await readComposerAttachments(fileList);
    setComposerAttachments((current) => [...current, ...next]);
  }, []);

  const removeComposerAttachment = useCallback((attachmentId: string) => {
    setComposerAttachments((current) => current.filter((item) => item.id !== attachmentId));
  }, []);

  const activeQueuedMessages = activeConversationId ? queuedMessagesByConversation[activeConversationId] ?? [] : [];
  const activeSendError = activeConversationId ? sendErrorsByConversation[activeConversationId] ?? null : null;

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
    onConversationSendError: (conversationId, error) => {
      setSendErrorsByConversation((current) => {
        if (error) {
          return { ...current, [conversationId]: error };
        }
        const next = { ...current };
        delete next[conversationId];
        return next;
      });
    },
    refreshGatewayStatus,
  });

  const handleAbort = useCallback(async () => {
    if (!activeConversationId || !sending) return;
    const runIdForAbort = activeConversation?.runtime?.activeRunId ?? activeRunId;
    try {
      await invoke("gateway_connect");
      await invoke("gateway_chat_abort", {
        sessionKey: activeConversationId,
        runId: runIdForAbort,
      });
      setGatewayError(null);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setGatewayError(messageText);
      setGatewayStatusText(`停止失败: ${messageText}`);
    }
  }, [activeConversation?.runtime?.activeRunId, activeConversationId, activeRunId, sending]);

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
      <AgentFilesDialog
        open={Boolean(agentFilesAgentId)}
        agentId={agentFilesAgentId}
        agentName={agents.find((agent) => agent.id === agentFilesAgentId)?.name}
        onClose={() => setAgentFilesAgentId(null)}
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
          gatewayConnected={gatewayConnected}
          gatewayVersion={openClawStatus?.runtimeVersion}
          updateAvailable={openClawCliStatus?.updateAvailable}
          sessionCount={openClawStatus?.sessions?.count}
          onOpenStatus={toggleOpenClawInfo}
        />

        {activeNav === "conversations" ? (
          <>
            <ResourceSidebar
              agents={agents}
              expandedConversationId={expandedConversationId}
              visible={showResourceSidebar}
              onCreateAgent={() => setAgentCreateOpen(true)}
              onEditAgentFiles={setAgentFilesAgentId}
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
              conversationRuntimeFilter={conversationRuntimeFilter}
              conversationRuntimeOptions={conversationRuntimeOptions}
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
              gatewayError={activeSendError}
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
              onConversationRuntimeFilterChange={setConversationRuntimeFilter}
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

        {activeNav === "models" ? (
          <ModelsPage
            configuredModels={modelsPageReady ? configuredModels : []}
            allModels={modelsPageReady ? allModels : []}
            authStatus={modelsPageReady ? modelAuthStatus : null}
            loading={modelsPageLoading || !modelsPageReady}
            currentDefaultModel={openClawStatus?.sessions?.defaults?.model}
            actionBusy={modelActionBusy}
            message={modelsActionMessage}
            onRefresh={() => void refreshModelsPage({ refreshAuth: true })}
            onSetDefault={(modelRef) => void handleSetDefaultModel(modelRef)}
            onAuthProvider={(provider, setDefault) => void handleModelAuthProvider(provider, setDefault)}
            onSaveProviderConfig={(draft) => void handleSaveProviderConfig(draft)}
            onSaveModelConfig={(draft) => void handleSaveModelConfig(draft)}
          />
        ) : null}

        {activeNav === "skills" ? (
          <SkillsPage
            skills={metadataPageReady ? skills : []}
            loading={metadataLoading || !metadataPageReady}
            onToggleSkill={(skillId, enabled) => void handleToggleSkill(skillId, enabled)}
          />
        ) : null}

        {activeNav === "connections" ? (
          <ConnectionsPage
            connections={metadataPageReady ? connections : []}
            connectionLabel={connectionLabel}
            loading={metadataLoading || !metadataPageReady}
            weixinStatus={weixinStatus}
            weixinBusy={weixinBusy}
            weixinMessage={weixinMessage}
            onRefreshWeixinStatus={() => void refreshWeixinPluginStatus()}
            onEnableWeixin={() => void ensureWeixinPluginEnabled()}
            onInstallWeixin={() => void runWeixinTerminalAction("open_weixin_plugin_install_terminal")}
            onUpdateWeixin={() => void runWeixinTerminalAction("open_weixin_plugin_update_terminal")}
            onLoginWeixin={() => void runWeixinTerminalAction("open_weixin_login_terminal")}
          />
        ) : null}

        {activeNav === "usage" ? (
          <UsagePage usage={usagePageReady ? usage : null} loading={usageLoading || !usagePageReady} />
        ) : null}
      </div>

      {openClawInfoOpen ? (
        <aside className="openclaw-info-drawer" role="dialog" aria-modal="true">
          <div className="openclaw-info-head">
            <div className="openclaw-info-status">
              <span className={`status-dot ${gatewayConnected ? "working" : "completed"}`} />
              <div>
                <strong>{gatewayConnected ? "OpenClaw 已连接" : "OpenClaw 未连接"}</strong>
                <span>{gatewayStatusText}</span>
              </div>
            </div>
            <button
              className={`openclaw-connect-switch ${openClawGatewayBusy ? "busy" : ""}`}
              type="button"
              title={gatewayConnected ? "停止 OpenClaw Gateway" : "启动 OpenClaw Gateway"}
              aria-label={gatewayConnected ? "停止 OpenClaw Gateway" : "启动 OpenClaw Gateway"}
              aria-pressed={gatewayConnected}
              disabled={openClawGatewayBusy}
              onClick={() => void toggleOpenClawGateway()}
            >
              <input
                type="checkbox"
                checked={gatewayConnected}
                readOnly
                tabIndex={-1}
              />
              <span />
            </button>
          </div>
          <div className="openclaw-info-metrics">
            <div><span>会话</span><strong>{openClawStatus?.sessions?.count ?? "-"}</strong></div>
            <div><span>默认模型</span><strong>{openClawStatus?.sessions?.defaults?.model || "-"}</strong></div>
            <div><span>默认 Agent</span><strong>{openClawStatus?.heartbeat?.defaultAgentId || "-"}</strong></div>
          </div>
          <div className={`openclaw-update-panel ${openClawCliStatus?.updateAvailable ? "available" : ""}`}>
            <div className="openclaw-update-row">
              <span>当前版本</span>
              <strong>{openClawCliStatus?.installedVersion || openClawStatus?.runtimeVersion || "-"}</strong>
            </div>
            <div className="openclaw-update-row">
              <span>最新版本</span>
              <strong>{openClawCliStatus?.latestVersion || (openClawCliStatus?.latestCheckError ? "检测失败" : "-")}</strong>
            </div>
            {openClawCliStatus?.latestCheckError ? (
              <p className="openclaw-update-note">{openClawCliStatus.latestCheckError}</p>
            ) : null}
            {openClawUpdateMessage ? <p className="openclaw-update-note">{openClawUpdateMessage}</p> : null}
            {openClawGatewayMessage ? <p className="openclaw-update-note">{openClawGatewayMessage}</p> : null}
            {openClawCliStatus?.updateAvailable ? (
              <button className="openclaw-update-button" type="button" onClick={() => void runOpenClawUpdate()} disabled={openClawUpdateBusy}>
                {openClawUpdateBusy ? "正在打开终端..." : "更新 OpenClaw"}
              </button>
            ) : null}
          </div>
          <div className="openclaw-info-actions">
            <button className="openclaw-home-button" type="button" onClick={() => void openLocalOpenClaw()} title="打开本地 OpenClaw">
              <span>⌂</span>
              打开本地 OpenClaw
            </button>
          </div>
        </aside>
      ) : null}
    </main>
  );
}

export default App;
