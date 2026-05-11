import { Suspense, lazy, useEffect, useMemo, useState, useCallback, useRef } from "react";
import { defaultWindowIcon } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GatewayBanner, ImageLightbox, NavSidebar } from "./components/AppChrome";
import { MandatoryAppUpdateModal } from "./components/MandatoryAppUpdateModal";
import { AgentCreateDialog } from "./components/AgentCreateDialog";
import { AgentFilesDialog } from "./components/AgentFilesDialog";
import { BootstrapScreens } from "./components/BootstrapScreens";
import { ConversationWorkspace } from "./components/ConversationWorkspace";
import { OpenClawInfoDrawer } from "./components/OpenClawInfoDrawer";
import { ResourceSidebar } from "./components/ResourceSidebar";
import { getLastAssistantMessage, mapGatewayHistoryMessages, resolveConversationDefaultModel as resolveConversationModel, summarizeMessageUsage } from "./lib/conversationHistory";
import { conversationMatchesSessionKey, findConversationById } from "./lib/conversationSelectors";
import { readComposerAttachments } from "./lib/composerAttachments";
import { useConversationAutoScroll } from "./hooks/useConversationAutoScroll";
import { useClawKitSettings } from "./hooks/useClawKitSettings";
import { useClawKitSelfUpdate } from "./hooks/useClawKitSelfUpdate";
import { useGatewayChat } from "./hooks/useGatewayChat";
import { useGatewaySnapshot } from "./hooks/useGatewaySnapshot";
import { useMessageSender } from "./hooks/useMessageSender";
import { useModels } from "./hooks/useModels";
import { useUiFrameDiagnostics } from "./hooks/useUiFrameDiagnostics";
import { useConversationWorkspaceState } from "./hooks/useConversationWorkspaceState";
import { usePetContextSync } from "./hooks/usePetContextSync";
import { useBootstrapFlow } from "./hooks/useBootstrapFlow";
import { useOpenClawRuntime } from "./hooks/useOpenClawRuntime";
import { useModelsPageData } from "./hooks/useModelsPageData";
import { useModelManagementActions } from "./hooks/useModelManagementActions";
import { buildAgentsFromSnapshot, hasActiveAgentRun, mergeGatewaySessionRowsIntoAgents, patchConversation, resolveAgentDefaultModel } from "./lib/agentsSnapshot";
import { connectionLabel, formatTokenCount } from "./lib/appFormatters";
import { parseSenderMeta } from "./lib/messageMeta";
import { canonicalizeModelRef } from "./lib/modelOptions";
import { mergeSnapshotMessagesPreservingCurrentOrder } from "./lib/toolStream";
import { isInternalOpenClawMessage } from "./lib/gatewayMessages";
import {
  applyPluginHealthToChannels,
  mapGatewaySkills,
} from "./lib/appDerivedData";
import {
  buildQqbotSettingsPatch,
  readQqbotEditorFormFromConfig,
  validateQqbotEditorForm,
  type QqbotEditorForm,
} from "./lib/qqbotChannelPatch";
import { describeUpdateRestartSentinel, extrapolateGatewayUptimeMs, formatApproxDurationMs } from "./lib/gatewayRuntimeInfo";
import { resolveComposerThinkingOptions } from "./lib/thinkingOptions";
import { buildAppearanceDataAttributes } from "./lib/appAppearance";
import { buildConversationCompletionNotification } from "./lib/conversationNotifications";
import { onNativeNotificationAction, sendNativeNotification } from "./lib/notifications";
import { createTranslator, resolveLocale } from "./lib/i18n";
import { shouldRunDestructiveAction } from "./lib/sessionConfirmations";
import { parseConversationFilters, serializeConversationFilters } from "./lib/appUiPersistence";
import type { Conversation, ConversationRuntime, PreviewMessage } from "./types/conversation";
import type { Agent, ChannelConnection, ComposerAttachment, NavKey, PluginRepairCard, QqbotPluginStatus, QueuedComposerMessage, Skill, WeixinPluginStatus } from "./types/app";
import type { GatewayAgentsCreateResult, GatewayAgentsUpdateResult, GatewayChannelsEventLoopHealth, GatewayChannelsStatusResult, GatewayConfigGetResult, GatewayConfigPatchResult, GatewayHistoryResult, GatewaySessionsListResult, GatewaySessionsUsageResult, GatewaySkillsStatusResult, GatewaySkillsUpdateResult, GatewayStatus, OpenClawSnapshot } from "./types/gateway";
import type { RealtimeGatewayEvent, RealtimeSessionMessageEvent } from "./realtime";
import "./App.css";

const agentsSeed: Agent[] = [];
const fallbackSkills: Skill[] = [];
const fallbackConnections: ChannelConnection[] = [];
const ModelsPage = lazy(async () => import("./components/ModelsPage").then((module) => ({ default: module.ModelsPage })));
const SkillsPage = lazy(async () => import("./components/InfoPages").then((module) => ({ default: module.SkillsPage })));
const ConnectionsPage = lazy(async () => import("./components/InfoPages").then((module) => ({ default: module.ConnectionsPage })));
const UsagePage = lazy(async () => import("./components/InfoPages").then((module) => ({ default: module.UsagePage })));
const CronPage = lazy(async () => import("./components/CronPage").then((module) => ({ default: module.CronPage })));
const PetsPage = lazy(async () => import("./components/PetsPage").then((module) => ({ default: module.PetsPage })));
const SettingsPage = lazy(async () => import("./components/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const OPENCLAW_VERSION_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const CONVERSATION_FILTERS_STORAGE_KEY = "clawkit.conversationFilters";
const LAST_CONVERSATION_STORAGE_KEY = "clawkit.lastConversationId";
const tr = (t: (key: string) => string, key: string, fallback: string) => {
  const value = t(key);
  return value === key ? fallback : value;
};

function readStorageValue(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Local storage can be unavailable in restricted webviews; settings still work without it.
  }
}

async function bringMainWindowForward() {
  const appWindow = getCurrentWindow();
  try {
    await appWindow.show();
    const minimized = await appWindow.isMinimized().catch(() => false);
    if (minimized) {
      await appWindow.unminimize();
    }
    await appWindow.setFocus();
    await appWindow.requestUserAttention(UserAttentionType.Informational).catch(() => undefined);
  } catch (error) {
    console.warn("Failed to bring ClawKit window forward", error);
  }
}

function App() {
  const {
    bootstrapStatus,
    bootstrapLoading,
    bootstrapError,
    bindingInProgress,
    bootstrapStep,
    bootstrapConnectError,
    setBootstrapStep,
    setBootstrapConnectError,
    loadBootstrapStatus,
    bindOpenClaw,
  } = useBootstrapFlow();
  const [agentCreateOpen, setAgentCreateOpen] = useState(false);
  const [agentCreating, setAgentCreating] = useState(false);
  const [agentCreateError, setAgentCreateError] = useState<string | null>(null);
  const [agentFilesAgentId, setAgentFilesAgentId] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState<NavKey>("conversations");
  const [conversationSearch, setConversationSearch] = useState(() => parseConversationFilters(readStorageValue(CONVERSATION_FILTERS_STORAGE_KEY)).search);
  const [conversationRuntimeFilter, setConversationRuntimeFilter] = useState(() => parseConversationFilters(readStorageValue(CONVERSATION_FILTERS_STORAGE_KEY)).runtimeFilter);
  const [conversationSort, setConversationSort] = useState<"updated" | "tokens" | "status">(() => parseConversationFilters(readStorageValue(CONVERSATION_FILTERS_STORAGE_KEY)).sort);
  const [openedConversationIds, setOpenedConversationIds] = useState<Record<string, true>>({});
  const [agents, setAgents] = useState(agentsSeed);
  const [expandedConversationId, setExpandedConversationId] = useState("");
  const [showResourceSidebar, setShowResourceSidebar] = useState(true);
  const [skills, setSkills] = useState<Skill[]>(fallbackSkills);
  const [connections, setConnections] = useState<ChannelConnection[]>(fallbackConnections);
  const [channelEventLoopHealth, setChannelEventLoopHealth] = useState<GatewayChannelsEventLoopHealth | null>(null);
  const [pluginLoadRepairs, setPluginLoadRepairs] = useState<PluginRepairCard[]>([]);
  const [unmatchedPluginRepairs, setUnmatchedPluginRepairs] = useState<PluginRepairCard[]>([]);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataPageReady, setMetadataPageReady] = useState(true);
  const [weixinStatus, setWeixinStatus] = useState<WeixinPluginStatus | null>(null);
  const [weixinBusy, setWeixinBusy] = useState(false);
  const [weixinMessage, setWeixinMessage] = useState<string | null>(null);
  const [qqbotStatus, setQqbotStatus] = useState<QqbotPluginStatus | null>(null);
  const [qqbotStatusBusy, setQqbotStatusBusy] = useState(false);
  const [qqbotBusy, setQqbotBusy] = useState(false);
  const [qqbotNotice, setQqbotNotice] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usage, setUsage] = useState<GatewaySessionsUsageResult | null>(null);
  const [usagePageReady, setUsagePageReady] = useState(true);
  const [gatewaySessionsDefaults, setGatewaySessionsDefaults] = useState<GatewaySessionsListResult["defaults"] | null>(null);
  const [openClawUpdateBusy, setOpenClawUpdateBusy] = useState(false);
  const [openClawUpdateMessage, setOpenClawUpdateMessage] = useState<string | null>(null);
  const [openClawGatewayBusy, setOpenClawGatewayBusy] = useState(false);
  const [openClawGatewayMessage, setOpenClawGatewayMessage] = useState<string | null>(null);
  const [settingsOpenClawActionBusy, setSettingsOpenClawActionBusy] = useState(false);
  const [settingsOpenClawActionMessage, setSettingsOpenClawActionMessage] = useState<string | null>(null);
  const [openClawInfoOpen, setOpenClawInfoOpen] = useState(false);
  const uiFrameDiagnostics = useUiFrameDiagnostics(bootstrapStep === "ready");
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const [composerValue, setComposerValue] = useState("");
  const { loadGatewaySnapshot } = useGatewaySnapshot();
  const [composerModel, setComposerModel] = useState("");
  const [composerThinking, setComposerThinking] = useState("off");
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [queuedMessagesByConversation, setQueuedMessagesByConversation] = useState<Record<string, QueuedComposerMessage[]>>({});
  const [sendErrorsByConversation, setSendErrorsByConversation] = useState<Record<string, string>>({});
  const [, setSending] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const autoSendingQueuedMessageRef = useRef<string | null>(null);
  const agentsRef = useRef<Agent[]>(agentsSeed);
  const previousConversationsRef = useRef<Map<string, Conversation>>(new Map());
  const notifiedConversationRunKeysRef = useRef<Set<string>>(new Set());
  const activeConversationIdRef = useRef<string | null>(null);
  const queuedMessagesByConversationRef = useRef<Record<string, QueuedComposerMessage[]>>({});
  const restoredLastConversationRef = useRef(false);
  const autoStartGatewayAttemptedRef = useRef(false);
  const suppressSessionRefreshUntilRef = useRef(0);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [gatewayStatusText, setGatewayStatusText] = useState("Gateway connecting...");
  const [gatewayUptimeBasisMs, setGatewayUptimeBasisMs] = useState<number | null>(null);
  const [gatewayUptimeRecordedAtMs, setGatewayUptimeRecordedAtMs] = useState<number | null>(null);
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() => (
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"
  ));
  const {
    settings: clawKitSettings,
    settingsLoading: clawKitSettingsLoading,
    settingsError: clawKitSettingsError,
    patchSettings,
  } = useClawKitSettings({ enabled: !bootstrapLoading });
  const maybeAutoStartOpenClawGateway = useCallback(async () => {
    if (!clawKitSettings.openclaw.autoStartGateway || autoStartGatewayAttemptedRef.current) {
      return;
    }
    autoStartGatewayAttemptedRef.current = true;
    try {
      await invoke("openclaw_gateway_start");
    } catch (error) {
      console.warn("Failed to auto-start OpenClaw Gateway", error);
    }
  }, [clawKitSettings.openclaw.autoStartGateway]);
  const locale = useMemo(
    () => resolveLocale(clawKitSettings.general.language, typeof navigator !== "undefined" ? navigator.language : null),
    [clawKitSettings.general.language],
  );
  const t = useMemo(() => createTranslator(locale), [locale]);
  const lazyPageFallback = <section className="workspace-area"><p className="empty-state">{t("common.loading")}</p></section>;
  const localizedStatusLabel = useMemo(
    () => ({
      working: tr(t, "conversation.status.working", "Running"),
      completed: tr(t, "conversation.status.completed", "Completed"),
      failed: tr(t, "conversation.status.failed", "Failed"),
      stopped: tr(t, "conversation.status.stopped", "Stopped"),
      idle: tr(t, "conversation.status.idle", "Idle"),
    }),
    [t],
  );
  const clawKitSelfUpdate = useClawKitSelfUpdate(
    bootstrapStep === "ready" && !clawKitSettingsLoading && clawKitSettings.general.autoCheckUpdates,
  );
  const [gatewayRuntimeTick, setGatewayRuntimeTick] = useState(0);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const [userExpanded, setUserExpanded] = useState(false);
  const [workspaceAnnouncement, setWorkspaceAnnouncement] = useState<string | null>(null);
  const [sessionActionBusy, setSessionActionBusy] = useState<string | null>(null);
  const [sessionActionError, setSessionActionError] = useState<string | null>(null);
  const petContextSnapshotRef = useRef("");
  const workspaceAnnouncementTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const announceWorkspace = useCallback((message: string) => {
    setWorkspaceAnnouncement(message);
    if (workspaceAnnouncementTimerRef.current) {
      clearTimeout(workspaceAnnouncementTimerRef.current);
    }
    workspaceAnnouncementTimerRef.current = setTimeout(() => {
      setWorkspaceAnnouncement(null);
      workspaceAnnouncementTimerRef.current = undefined;
    }, 3200);
  }, []);

  useEffect(() => () => {
    if (workspaceAnnouncementTimerRef.current) {
      clearTimeout(workspaceAnnouncementTimerRef.current);
    }
  }, []);

  useEffect(() => {
    setSessionActionError(null);
    setSessionActionBusy(null);
  }, [activeConversationId]);

  useEffect(() => {
    let cancelled = false;

    async function applyWindowIcon() {
      try {
        const icon = await defaultWindowIcon();
        if (!cancelled && icon) {
          await getCurrentWindow().setIcon(icon);
        }
      } catch (error) {
        console.warn("Failed to apply ClawKit window icon", error);
      }
    }

    void applyWindowIcon();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void bringMainWindowForward();
  }, []);

  useEffect(() => {
    if (clawKitSettingsError) {
      console.warn("Failed to load ClawKit settings", clawKitSettingsError);
    }
  }, [clawKitSettingsError]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const updateTheme = () => setSystemTheme(query.matches ? "light" : "dark");
    updateTheme();
    query.addEventListener("change", updateTheme);
    return () => query.removeEventListener("change", updateTheme);
  }, []);

  useEffect(() => {
    queuedMessagesByConversationRef.current = queuedMessagesByConversation;
  }, [queuedMessagesByConversation]);

  useEffect(() => {
    const previousConversations = previousConversationsRef.current;
    const nextConversations = new Map<string, Conversation>();
    const windowFocused = typeof document !== "undefined" ? document.hasFocus() : false;

    for (const agent of agents) {
      for (const conversation of agent.conversations) {
        nextConversations.set(conversation.id, conversation);
        const notification = buildConversationCompletionNotification({
          previous: previousConversations.get(conversation.id) ?? null,
          current: conversation,
          settings: clawKitSettings.notifications,
          windowFocused,
          seenKeys: notifiedConversationRunKeysRef.current,
          copy: {
            genericFinished: t("notification.genericFinished"),
            completed: t("notification.completed"),
            failed: t("notification.failed"),
          },
        });
        if (notification) {
          void sendNativeNotification({
            key: notification.key,
            title: notification.title,
            body: notification.body,
            conversationId: conversation.id,
          });
        }
      }
    }

    previousConversationsRef.current = nextConversations;
    agentsRef.current = agents;
  }, [agents, clawKitSettings.notifications, t]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    if (clawKitSettingsLoading || !clawKitSettings.general.rememberConversationFilters) {
      return;
    }
    writeStorageValue(
      CONVERSATION_FILTERS_STORAGE_KEY,
      serializeConversationFilters({
        search: conversationSearch,
        runtimeFilter: conversationRuntimeFilter,
        sort: conversationSort,
      }),
    );
  }, [
    clawKitSettings.general.rememberConversationFilters,
    clawKitSettingsLoading,
    conversationRuntimeFilter,
    conversationSearch,
    conversationSort,
  ]);

  useEffect(() => {
    if (clawKitSettingsLoading || !clawKitSettings.general.restoreLastConversation || !activeConversationId) {
      return;
    }
    writeStorageValue(LAST_CONVERSATION_STORAGE_KEY, activeConversationId);
  }, [activeConversationId, clawKitSettings.general.restoreLastConversation, clawKitSettingsLoading]);

  const refreshWeixinPluginStatus = useCallback(async () => {
    setWeixinBusy(true);
    try {
      const status = await invoke<WeixinPluginStatus>("weixin_plugin_status");
      setWeixinStatus(status);
    } catch (error) {
      console.warn("Failed to refresh WeChat plugin status", error);
      setWeixinMessage(error instanceof Error ? error.message : t("app.wechatPluginStatusFailed"));
    } finally {
      setWeixinBusy(false);
    }
  }, []);

  const refreshQqbotPluginStatus = useCallback(async () => {
    setQqbotStatusBusy(true);
    try {
      const status = await invoke<QqbotPluginStatus>("qqbot_plugin_status");
      setQqbotStatus(status);
    } catch (error) {
      console.warn("Failed to refresh QQ Bot plugin status", error);
      setQqbotNotice({
        text: error instanceof Error ? error.message : t("app.qqbotPluginStatusFailed"),
        tone: "error",
      });
    } finally {
      setQqbotStatusBusy(false);
    }
  }, []);

  const refreshGatewaySkills = useCallback(async () => {
    setMetadataLoading(true);
    try {
      await invoke("gateway_connect");
      const skillsResult = await invoke<GatewaySkillsStatusResult>("gateway_skills_status", { params: {} });
      setSkills(mapGatewaySkills(skillsResult));
    } catch (error) {
      console.warn("Failed to refresh Gateway skills", error);
    } finally {
      setMetadataLoading(false);
    }
  }, []);

  const refreshGatewayConnections = useCallback(async () => {
    setMetadataLoading(true);
    try {
      await invoke("gateway_connect");
      const [channelsResult, healthRaw] = await Promise.all([
        invoke<GatewayChannelsStatusResult>("gateway_channels_status", {
          params: { probe: false, timeoutMs: 2000 },
        }),
        invoke<unknown>("gateway_health", { probe: false }).catch(() => null),
      ]);
      const applied = applyPluginHealthToChannels(channelsResult, healthRaw);
      setConnections(applied.connections);
      setChannelEventLoopHealth(applied.eventLoop ?? null);
      setPluginLoadRepairs(applied.repairs);
      setUnmatchedPluginRepairs(applied.unmatched);
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
      await refreshGatewayConnections();
    } catch (error) {
      console.error("Failed to enable WeChat plugin", error);
      setWeixinMessage(error instanceof Error ? error.message : t("app.wechatPluginEnableFailed"));
    } finally {
      setWeixinBusy(false);
    }
  }, [refreshGatewayConnections, refreshWeixinPluginStatus]);

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
          await maybeAutoStartOpenClawGateway();
          await invoke("gateway_connect");
          if (!cancelled) {
            setBootstrapStep("ready");
          }
        } catch (error) {
          console.error("Gateway connect test failed", error);
          if (!cancelled) {
            setBootstrapConnectError(error instanceof Error ? error.message : t("app.gatewayConnectionTestFailed"));
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
        await maybeAutoStartOpenClawGateway();
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
          const gatewayLoad = await loadGatewaySnapshot({ fallbackSnapshot });
          if (cancelled) {
            return;
          }
          snapshot = gatewayLoad.snapshot;
          setGatewaySessionsDefaults(gatewayLoad.sessionsDefaults ?? null);
        } catch (error) {
          console.warn("Gateway snapshot unavailable, falling back to local OpenClaw snapshot", error);
          if (!cancelled) {
            setGatewaySessionsDefaults(null);
          }
        }
        setAgents(buildAgentsFromSnapshot(snapshot, currentAgentSnapshots, { preserveExistingConversations: true }));
      } catch (error) {
        console.error("Failed to load OpenClaw snapshot", error);
      }
    };

    /**
     * Targeted reconciliation: merge `sessions.list` rows only (no sessions.preview fan-out).
     * Falls back to full snapshot when store shape diverges (new/removed sessions).
     */
    const loadSnapshotLightMergeSessionsList = async () => {
      try {
        const currentAgentSnapshots = agentsRef.current;
        await invoke("gateway_connect");
        const sessionsResult = await invoke<GatewaySessionsListResult>("gateway_sessions_list", {
          params: {
            limit: 100,
            includeDerivedTitles: true,
            includeLastMessage: true,
            includeGlobal: false,
            includeUnknown: false,
          },
        });
        if (cancelled) {
          return;
        }
        const rows = sessionsResult.sessions ?? [];
        const localIds = currentAgentSnapshots
          .flatMap((agent) => agent.conversations.map((conversation) => conversation.id))
          .filter((id) => !id.startsWith("draft-"));
        const hasNewSessionsFromGateway = rows.some((row) => !localIds.includes(row.key));
        if (hasNewSessionsFromGateway) {
          await loadSnapshot();
          return;
        }
        const transcriptSourceOfTruthIds = new Set<string>();
        const aid = activeConversationIdRef.current;
        if (aid) transcriptSourceOfTruthIds.add(aid);
        for (const agent of currentAgentSnapshots) {
          for (const conversation of agent.conversations) {
            if (conversation.runtime?.activeRunId) transcriptSourceOfTruthIds.add(conversation.id);
          }
        }
        setAgents(mergeGatewaySessionRowsIntoAgents(currentAgentSnapshots, rows, { transcriptSourceOfTruthIds }));
        setGatewaySessionsDefaults(sessionsResult.defaults ?? null);
      } catch (error) {
        console.warn("Gateway sessions.list merge failed, falling back to full snapshot", error);
        await loadSnapshot();
      }
    };


    // Load snapshot only once on startup
    void loadSnapshot();

    void (async () => {
      try {
        await invoke("gateway_sessions_subscribe");
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen("clawkit://sessions-changed", () => {
          if (refreshTimer) {
            clearTimeout(refreshTimer);
          }
          refreshTimer = setTimeout(() => {
            if (Date.now() < suppressSessionRefreshUntilRef.current) {
              return;
            }
            if (hasActiveAgentRun(agentsRef.current)) {
              void loadSnapshotLightMergeSessionsList();
            } else {
              void loadSnapshot();
            }
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
  }, [
    bootstrapStatus?.bindingConfigured,
    bootstrapStatus?.openclawInstalled,
    bootstrapStep,
    loadGatewaySnapshot,
    maybeAutoStartOpenClawGateway,
  ]);

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
                      lastRunStartedAt: conversation.runtime?.activeStartedAt ?? conversation.runtime?.lastRunStartedAt ?? nextUpdatedAt ?? Date.now(),
                      lastEventAt: nextUpdatedAt,
                    }
                  : isTerminalSnapshot
                    ? {
                        ...conversation.runtime,
                        activeRunId: undefined,
                        activeStartedAt: undefined,
                        lastRunStartedAt: conversation.runtime?.activeStartedAt ?? conversation.runtime?.lastRunStartedAt,
                        lastEventAt: nextUpdatedAt,
                        lastTerminalAt: nextUpdatedAt,
                        lastTerminalReason: terminalReason,
                      }
                    : isActiveSnapshot && !isFreshActiveSnapshot
                      ? {
                          ...conversation.runtime,
                      activeRunId: undefined,
                      activeStartedAt: undefined,
                      lastRunStartedAt: conversation.runtime?.activeStartedAt ?? conversation.runtime?.lastRunStartedAt,
                      lastEventAt: nextUpdatedAt,
                      lastTerminalAt: conversation.runtime?.lastTerminalAt ?? nextUpdatedAt,
                      lastTerminalReason: conversation.runtime?.lastTerminalReason ?? "interrupted",
                        }
                      : conversation.runtime ?? {
                      activeRunId: undefined,
                      activeStartedAt: undefined,
                      lastRunStartedAt: undefined,
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

  useEffect(() => {
    if (!openClawInfoOpen || !gatewayConnected) return undefined;
    const id = window.setInterval(() => setGatewayRuntimeTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, [openClawInfoOpen, gatewayConnected]);

  const gatewayProcessUptimeLabel = useMemo(() => {
    void gatewayRuntimeTick;
    const ms = extrapolateGatewayUptimeMs({
      basisMs: gatewayUptimeBasisMs,
      recordedAtMs: gatewayUptimeRecordedAtMs,
    });
    return ms == null ? null : formatApproxDurationMs(ms);
  }, [gatewayRuntimeTick, gatewayUptimeBasisMs, gatewayUptimeRecordedAtMs]);

  const refreshGatewayStatus = useCallback(async () => {
    try {
      const status = await invoke<GatewayStatus>("gateway_status");
      setGatewayConnected(status.connected);
      setGatewayStatusText(status.statusText || (status.connected ? t("app.gatewayConnected") : t("app.gatewayDisconnected")));
      setGatewayError(status.error ?? null);
      setGatewayUptimeBasisMs(status.gatewayUptimeBasisMs ?? null);
      setGatewayUptimeRecordedAtMs(status.gatewayUptimeRecordedAtMs ?? null);
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
                lastRunStartedAt: currentConversation.runtime?.activeStartedAt ?? currentConversation.runtime?.lastRunStartedAt,
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
      setGatewayStatusText(`${t("app.gatewayStatusFetchFailed")}: ${message}`);
      setGatewayError(message);
      setGatewayUptimeBasisMs(null);
      setGatewayUptimeRecordedAtMs(null);
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
              lastRunStartedAt: currentConversation.runtime?.activeStartedAt ?? currentConversation.runtime?.lastRunStartedAt,
              lastEventAt: disconnectedAt,
              lastTerminalAt: disconnectedAt,
              lastTerminalReason: "interrupted",
            },
          }));
        }),
      })));
    }
  }, []);

  const {
    openClawStatus,
    openClawConfigDefaultModel,
    openClawConfigDefaultModelLoaded,
    openClawCliStatus,
    gatewayUpdateRestartSentinel,
    setOpenClawStatus,
    setOpenClawConfigDefaultModel,
    setOpenClawConfigDefaultModelLoaded,
    setGatewayUpdateRestartSentinel,
    refreshOpenClawDefaultModel,
    refreshOpenClawStatus,
    refreshOpenClawCliStatus,
  } = useOpenClawRuntime({ refreshGatewayStatus });
  const gatewayRestartSentinelLine = useMemo(
    () => describeUpdateRestartSentinel(gatewayUpdateRestartSentinel),
    [gatewayUpdateRestartSentinel],
  );
  const currentDefaultModel = openClawStatus?.sessions?.defaults?.model ?? gatewaySessionsDefaults?.model ?? openClawConfigDefaultModel ?? null;
  const { modelOptions, modelsLoading, setModelOptions } = useModels({
    enabled: bootstrapStep === "ready" && openClawConfigDefaultModelLoaded,
    defaultModel: currentDefaultModel,
  });
  const {
    modelsPageLoading,
    modelActionBusy,
    modelsActionMessage,
    configuredModels,
    allModels,
    modelAuthStatus,
    modelsPageReady,
    setModelActionBusy,
    setModelsActionMessage,
    setModelsPageLoading,
    setModelsPageReady,
    refreshModelsPage,
  } = useModelsPageData({
    currentDefaultModel,
    setModelOptions,
    refreshFailedMessage: t("app.modelStatusRefreshFailed"),
  });

  const patchOpenClawConfig = useCallback(async (patch: unknown) => {
    const current = await invoke<GatewayConfigGetResult>("gateway_config_get");
    if (!current.hash) {
      throw new Error(t("app.openclawConfigHashMissing"));
    }
    await invoke<GatewayConfigPatchResult>("gateway_config_patch", {
      params: {
        raw: JSON.stringify(patch),
        baseHash: current.hash,
        restartDelayMs: 300,
      },
    });
  }, []);

  const {
    handleSetDefaultModel,
    handleModelAuthProvider,
    handleSaveProviderConfig,
    handleSaveModelConfig,
  } = useModelManagementActions({
    t,
    patchOpenClawConfig,
    refreshModelsPage,
    refreshOpenClawStatus,
    setModelActionBusy,
    setModelsActionMessage,
    setComposerModel,
    setOpenClawConfigDefaultModel,
    setOpenClawConfigDefaultModelLoaded,
    setOpenClawStatus,
  });

  const loadQqbotEditorForm = useCallback(async (): Promise<QqbotEditorForm> => {
    await invoke("gateway_connect");
    const current = await invoke<GatewayConfigGetResult>("gateway_config_get");
    return readQqbotEditorFormFromConfig(current.config);
  }, []);

  const saveQqbotSettings = useCallback(
    async (form: QqbotEditorForm) => {
      const validationMessage = validateQqbotEditorForm(form);
      if (validationMessage) {
        setQqbotNotice({ text: validationMessage, tone: "error" });
        return;
      }
      setQqbotBusy(true);
      setQqbotNotice(null);
      try {
        await invoke("gateway_connect");
        await patchOpenClawConfig(buildQqbotSettingsPatch(form));
        setQqbotNotice({
          text: t("app.qqbotConfigSavedRestartGateway"),
          tone: "success",
        });
        void refreshGatewayConnections();
      } catch (error) {
        setQqbotNotice({
          text: error instanceof Error ? error.message : t("app.qqbotConfigSaveFailed"),
          tone: "error",
        });
      } finally {
        setQqbotBusy(false);
      }
    },
    [patchOpenClawConfig, refreshGatewayConnections],
  );

  const runQqbotPluginInstall = useCallback(async () => {
    setQqbotStatusBusy(true);
    try {
      const message = await invoke<string>("open_qqbot_plugin_install_terminal");
      setQqbotNotice({ text: message, tone: "success" });
      await refreshQqbotPluginStatus();
      void refreshGatewayConnections();
    } catch (error) {
      setQqbotNotice({
        text: error instanceof Error ? error.message : t("app.qqbotInstallTerminalFailed"),
        tone: "error",
      });
    } finally {
      setQqbotStatusBusy(false);
    }
  }, [refreshGatewayConnections, refreshQqbotPluginStatus]);

  const mergeSessionsListFromGateway = useCallback(async () => {
    await invoke("gateway_connect");
    const sessionsResult = await invoke<GatewaySessionsListResult>("gateway_sessions_list", {
      params: {
        limit: 100,
        includeDerivedTitles: true,
        includeLastMessage: true,
        includeGlobal: false,
        includeUnknown: false,
      },
    });
    const rows = sessionsResult.sessions ?? [];
    const transcriptSourceOfTruthIds = new Set<string>();
    const aid = activeConversationIdRef.current;
    if (aid) transcriptSourceOfTruthIds.add(aid);
    for (const agent of agentsRef.current) {
      for (const conversation of agent.conversations) {
        if (conversation.runtime?.activeRunId) transcriptSourceOfTruthIds.add(conversation.id);
      }
    }
    setAgents(mergeGatewaySessionRowsIntoAgents(agentsRef.current, rows, { transcriptSourceOfTruthIds }));
    setGatewaySessionsDefaults(sessionsResult.defaults ?? null);
  }, []);

  const handleResetComposerThinkingDefault = useCallback(async () => {
    const key = activeConversationId;
    if (!key || key.startsWith("draft-")) return;
    setSessionActionError(null);
    try {
      await invoke("gateway_connect");
      await invoke("gateway_sessions_patch", {
        params: { sessionKey: key, thinkingLevel: null },
      });
      await mergeSessionsListFromGateway();
      announceWorkspace(t("app.restoredThinkingDefault"));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setSessionActionError(`${t("app.restoreThinkingDefaultFailed")}: ${messageText}`);
    }
  }, [activeConversationId, announceWorkspace, mergeSessionsListFromGateway]);

  const handleResetComposerFastDefault = useCallback(async () => {
    const key = activeConversationId;
    if (!key || key.startsWith("draft-")) return;
    setSessionActionError(null);
    try {
      await invoke("gateway_connect");
      await invoke("gateway_sessions_patch", {
        params: { sessionKey: key, fastMode: null },
      });
      await mergeSessionsListFromGateway();
      announceWorkspace(t("app.restoredFastDefault"));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setSessionActionError(`${t("app.restoreFastDefaultFailed")}: ${messageText}`);
    }
  }, [activeConversationId, announceWorkspace, mergeSessionsListFromGateway]);

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
      setOpenClawUpdateMessage(error instanceof Error ? error.message : t("app.openclawUpdateFailed"));
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
      setOpenClawGatewayMessage(message || (shouldStop ? t("app.openclawGatewayStopped") : t("app.openclawGatewayStarted")));
      if (shouldStop) {
        setGatewayConnected(false);
        setGatewayStatusText(t("app.openclawGatewayStoppedShort"));
        setOpenClawStatus(null);
        setGatewayUpdateRestartSentinel(null);
        setGatewayUptimeBasisMs(null);
        setGatewayUptimeRecordedAtMs(null);
      }
      window.setTimeout(() => void refreshOpenClawStatus(), shouldStop ? 900 : 1200);
    } catch (error) {
      console.error(`Failed to ${shouldStop ? "stop" : "start"} OpenClaw Gateway`, error);
      setOpenClawGatewayMessage(error instanceof Error ? error.message : (shouldStop ? t("app.stopOpenClawFailed") : t("app.startOpenClawFailed")));
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

  const runSettingsOpenClawAction = useCallback(async (action: () => Promise<string | void>) => {
    setSettingsOpenClawActionBusy(true);
    setSettingsOpenClawActionMessage(null);
    try {
      const message = await action();
      setSettingsOpenClawActionMessage(message || t("app.actionExecuted"));
    } catch (error) {
      setSettingsOpenClawActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSettingsOpenClawActionBusy(false);
    }
  }, []);

  const refreshSettingsOpenClawStatus = useCallback(() => {
    void runSettingsOpenClawAction(async () => {
      await Promise.all([loadBootstrapStatus(), refreshOpenClawCliStatus(), refreshOpenClawStatus()]);
      return t("app.statusRefreshed");
    });
  }, [loadBootstrapStatus, refreshOpenClawCliStatus, refreshOpenClawStatus, runSettingsOpenClawAction]);

  const reconnectSettingsGateway = useCallback(() => {
    void runSettingsOpenClawAction(async () => {
      await invoke("gateway_connect");
      await refreshOpenClawStatus();
      return t("app.gatewayReconnected");
    });
  }, [refreshOpenClawStatus, runSettingsOpenClawAction]);

  const repairSettingsBinding = useCallback(() => {
    void runSettingsOpenClawAction(async () => {
      await bindOpenClaw();
      await loadBootstrapStatus();
      return t("app.clawkitBindingRewritten");
    });
  }, [bindOpenClaw, loadBootstrapStatus, runSettingsOpenClawAction]);

  const installOpenClawFromSettings = useCallback(() => {
    void runSettingsOpenClawAction(async () => {
      const message = await invoke<string>("open_openclaw_install_terminal");
      window.setTimeout(() => {
        void loadBootstrapStatus();
        void refreshOpenClawCliStatus();
      }, 1500);
      return message;
    });
  }, [loadBootstrapStatus, refreshOpenClawCliStatus, runSettingsOpenClawAction]);

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
      await refreshGatewaySkills();
    } catch (error) {
      console.error("Failed to update skill", error);
      setSkills((current) => current.map((skill) => (skill.id === skillId ? { ...skill, enabled: !enabled } : skill)));
    }
  }, [refreshGatewaySkills]);

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
        void refreshGatewaySkills();
      }, 80);
    }
    if (activeNav === "connections") {
      scheduleAfterPaint(() => {
        setMetadataPageReady(true);
        void refreshGatewayConnections();
      }, 80);
      scheduleAfterPaint(() => void refreshWeixinPluginStatus(), 430);
      scheduleAfterPaint(() => void refreshQqbotPluginStatus(), 430);
    }
    if (activeNav === "models" && openClawConfigDefaultModelLoaded) {
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
  }, [activeNav, bootstrapStep, openClawConfigDefaultModelLoaded, refreshGatewayConnections, refreshGatewaySkills, refreshModelsPage, refreshQqbotPluginStatus, refreshUsage, refreshWeixinPluginStatus]);

  useEffect(() => {
    if (bootstrapStep !== "ready") {
      setOpenClawConfigDefaultModelLoaded(false);
      return;
    }
    void refreshOpenClawDefaultModel();
  }, [bootstrapStep, refreshOpenClawDefaultModel]);

  useEffect(() => {
    if (bootstrapStep !== "ready" || clawKitSettingsLoading || !clawKitSettings.general.autoCheckUpdates) {
      return undefined;
    }
    void refreshOpenClawCliStatus();
    const interval = window.setInterval(() => {
      void refreshOpenClawCliStatus();
    }, OPENCLAW_VERSION_CHECK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [bootstrapStep, clawKitSettings.general.autoCheckUpdates, clawKitSettingsLoading, refreshOpenClawCliStatus]);

  const refreshGatewaySnapshot = useCallback(async (options?: { priorityAgentId?: string }) => {
    const fallbackSnapshot = await invoke<OpenClawSnapshot>("load_openclaw_snapshot");
    const { snapshot, sessionsDefaults } = await loadGatewaySnapshot({ fallbackSnapshot });
    setGatewaySessionsDefaults(sessionsDefaults ?? null);
    setAgents(buildAgentsFromSnapshot(snapshot, agentsRef.current, {
      preserveExistingConversations: true,
      priorityAgentId: options?.priorityAgentId,
    }));
  }, [loadGatewaySnapshot]);

  const runWeixinTerminalAction = useCallback(async (command: "open_weixin_plugin_install_terminal" | "open_weixin_plugin_update_terminal" | "open_weixin_login_terminal") => {
    setWeixinBusy(true);
    setWeixinMessage(null);
    try {
      const message = await invoke<string>(command);
      setWeixinMessage(message);
      if (command !== "open_weixin_login_terminal") {
        window.setTimeout(() => {
          void refreshWeixinPluginStatus();
          void refreshGatewayConnections();
        }, 1500);
      }
    } catch (error) {
      console.error(`Failed to run ${command}`, error);
      setWeixinMessage(error instanceof Error ? error.message : t("app.wechatActionFailed"));
    } finally {
      setWeixinBusy(false);
    }
  }, [refreshGatewayConnections, refreshWeixinPluginStatus]);

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

  const suppressSessionRefreshAfterTerminalChat = useCallback(() => {
    suppressSessionRefreshUntilRef.current = Number.POSITIVE_INFINITY;
  }, []);

  useGatewayChat({
    enabled: bootstrapStep === "ready",
    activeConversationId,
    activeRunId,
    agentsRef,
    onAgentsChange: setAgents,
    onActiveRunIdChange: setActiveRunId,
    onSendingChange: setSending,
    onGatewayError: setGatewayError,
    onGatewayStatusTextChange: setGatewayStatusText,
    onGatewayConnectedChange: setGatewayConnected,
    refreshGatewayStatus,
    onTerminalChatEvent: suppressSessionRefreshAfterTerminalChat,
  });

  const {
    visibleConversations,
    conversationRuntimeOptions,
    conversationFiltersActive,
    filteredVisibleConversations,
    activeConversation,
  } = useConversationWorkspaceState({
    agents,
    activeConversationId,
    expandedConversationId,
    openedConversationIds,
    conversationSearch,
    conversationRuntimeFilter,
    conversationSort,
  });

  useEffect(() => {
    if (
      restoredLastConversationRef.current ||
      !clawKitSettings.general.restoreLastConversation ||
      activeConversationId ||
      visibleConversations.length === 0
    ) {
      return;
    }

    restoredLastConversationRef.current = true;
    const lastConversationId = readStorageValue(LAST_CONVERSATION_STORAGE_KEY);
    if (lastConversationId && visibleConversations.some((conversation) => conversation.id === lastConversationId)) {
      setActiveConversationId(lastConversationId);
    }
  }, [activeConversationId, clawKitSettings.general.restoreLastConversation, visibleConversations]);

  const { petContext } = usePetContextSync({
    agents,
    activeConversation,
    activeConversationId,
    activeNav,
    agentsRef,
    activeConversationIdRef,
    petContextSnapshotRef,
  });
  const composerThinkingOptions = useMemo(
    () => resolveComposerThinkingOptions(activeConversation ?? null, gatewaySessionsDefaults),
    [activeConversation, gatewaySessionsDefaults],
  );
  const activeConversationRef = useRef<Conversation | null>(null);

  useEffect(() => {
    activeConversationRef.current = activeConversation;
  }, [activeConversation]);

  const resolveConversationDefaultModel = useCallback((conversation: Conversation | null) => {
    const lastAssistant = getLastAssistantMessage(conversation?.previewMessages ?? []);
    const rawModel = resolveConversationModel(conversation, modelOptions[0]?.value ?? "");
    return canonicalizeModelRef(rawModel, modelOptions, lastAssistant?.provider);
  }, [modelOptions]);

  const resolveConversationDefaultThinking = useCallback((conversation: Conversation | null) => {
    const options =
      resolveComposerThinkingOptions(conversation, gatewaySessionsDefaults) ??
      conversation?.thinkingOptions ??
      [];
    if (options.length === 0 || options.some((option) => option.value === "off")) {
      return "off";
    }
    return options[0]?.value ?? "off";
  }, [gatewaySessionsDefaults]);

  // Update composer model when conversation changes or previewMessages update
  useEffect(() => {
    setComposerModel(resolveConversationDefaultModel(activeConversation));
  }, [activeConversation?.id, resolveConversationDefaultModel]);

  useEffect(() => {
    setComposerThinking(resolveConversationDefaultThinking(activeConversation));
  }, [activeConversation?.id, activeConversation?.thinkingDefault, activeConversation?.thinkingOptions, gatewaySessionsDefaults, resolveConversationDefaultThinking]);

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
    const draftThinkingOptions =
      resolveComposerThinkingOptions(null, gatewaySessionsDefaults) ?? [{ value: "off", label: "off" }];
    const gatewayThinkingDefault = gatewaySessionsDefaults?.thinkingDefault?.trim();
    const draftThinkingDefault =
      gatewayThinkingDefault && draftThinkingOptions.some((option) => option.value === gatewayThinkingDefault)
        ? gatewayThinkingDefault
        : draftThinkingOptions[0]?.value ?? "off";

    setAgents((current) => current.map((agent) => {
      if (agent.id !== agentId) return agent;
      const nextConversation: Conversation = {
        id: draftId,
        title: t("conversation.newTitle"),
        status: "idle",
        lastMessage: "",
        lastTime: new Date().toLocaleString("zh-CN"),
        updatedAt: now,
        tokens: "--",
        model: defaultModel || t("app.notConfigured"),
        thinkingDefault: draftThinkingDefault,
        thinkingOptions: draftThinkingOptions,
        workspace: t("app.workspaceNotConfigured"),
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
  }, [agents, gatewaySessionsDefaults, modelOptions]);

  const toggleConversationVisibility = useCallback((agentId: string, conversationId: string, visible: boolean) => {
    const conv = findConversationById(agentsRef.current, conversationId);
    const label = conv?.title ?? conversationId;
    if (visible) {
      announceWorkspace(`"${label}" ${t("app.addedToMainWorkspace")}`);
    } else {
      announceWorkspace(`"${label}" ${t("app.hiddenFromMainWorkspace")}`);
    }
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
    } else {
      setOpenedConversationIds((current) => {
        const next = { ...current };
        delete next[conversationId];
        return next;
      });
      setExpandedConversationId((current) => (current === conversationId ? "" : current));
    }
  }, [announceWorkspace, t]);

  const openConversationDetail = useCallback(async (conversationId: string, preserveStatus = false) => {
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
                lastRunStartedAt: undefined,
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
  }, [refreshGatewayStatus]);

  const handleOpenCronSessionKey = useCallback(
    (sessionKey: string) => {
      setActiveNav("conversations");
      window.requestAnimationFrame(() => {
        void openConversationDetail(sessionKey);
      });
    },
    [openConversationDetail],
  );

  const openConversationDetailRef = useRef(openConversationDetail);

  useEffect(() => {
    openConversationDetailRef.current = openConversationDetail;
  }, [openConversationDetail]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void | Promise<void>) | undefined;

    void (async () => {
      try {
        const listener = await onNativeNotificationAction(async (conversationId) => {
          await bringMainWindowForward();
          if (cancelled) return;
          setActiveNav("conversations");
          await openConversationDetailRef.current(conversationId);
        });
        cleanup = () => listener.unregister();
        if (cancelled) {
          void cleanup();
        }
      } catch (error) {
        console.warn("Failed to listen for notification actions", error);
      }
    })();

    return () => {
      cancelled = true;
      void cleanup?.();
    };
  }, []);

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
        const unlisten = await listen<RealtimeSessionMessageEvent>("clawkit://session-message", (event) => {
          const active = activeConversationRef.current;
          const eventKey = event.payload?.sessionKey;
          if (!active || !eventKey || !conversationMatchesSessionKey(active, eventKey)) {
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
  const activeConversationSending =
    activeConversation?.status === "working" ||
    Boolean(activeConversation?.runtime?.activeRunId);
  const activeSendError = activeConversationId ? sendErrorsByConversation[activeConversationId] ?? null : null;
  const sessionOverrideResetEnabled = useMemo(
    () => Boolean(activeConversationId && !activeConversationId.startsWith("draft-") && !activeConversation?.isDraft),
    [activeConversation?.isDraft, activeConversationId],
  );
  const handleClearConversationFilters = useCallback(() => {
    setConversationSearch("");
    setConversationRuntimeFilter("all");
  }, []);
  const handleBackToConversationList = useCallback(() => {
    setActiveConversationId(null);
  }, []);
  const handleHideConversation = useCallback((agentId: string, conversationId: string) => {
    toggleConversationVisibility(agentId, conversationId, false);
  }, [toggleConversationVisibility]);
  const handleUpdateConversationTitle = useCallback(async (conversationId: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    const target = findConversationById(agentsRef.current, conversationId);
    const isDraftConversation = target?.isDraft ?? false;
    if (isDraftConversation) {
      setAgents((current) => current.map((agent) => ({
        ...agent,
        conversations: agent.conversations.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, title: trimmed } : conversation,
        ),
      })));
      return;
    }
    await invoke("gateway_sessions_patch", {
      params: {
        sessionKey: conversationId,
        label: trimmed,
      },
    });
    setAgents((current) => current.map((agent) => ({
      ...agent,
      conversations: agent.conversations.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, title: trimmed } : conversation,
      ),
    })));
  }, []);

  const enqueueComposerMessage = useCallback((conversationId: string, text: string, attachments: ComposerAttachment[]) => {
    const item: QueuedComposerMessage = {
      id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      attachments,
      createdAt: Date.now(),
      model: composerModel,
      thinking: composerThinking,
    };
    setQueuedMessagesByConversation((current) => ({
      ...current,
      [conversationId]: [...(current[conversationId] ?? []), item],
    }));
  }, [composerModel, composerThinking]);

  const removeQueuedMessage = useCallback((messageId: string) => {
    if (!activeConversationId) return;
    setQueuedMessagesByConversation((current) => ({
      ...current,
      [activeConversationId]: (current[activeConversationId] ?? []).filter((item) => item.id !== messageId),
    }));
  }, [activeConversationId]);

  const { sendMessageToConversation } = useMessageSender({
    agents,
    modelOptions,
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
    if (!activeConversationId) return;
    const runIdForAbort = activeConversation?.runtime?.activeRunId ?? null;
    if (!activeConversationSending && !runIdForAbort) return;
    setSessionActionBusy("abort");
    setSessionActionError(null);
    try {
      await invoke("gateway_connect");
      await invoke("gateway_chat_abort", {
        sessionKey: activeConversationId,
        runId: runIdForAbort,
      });
      setGatewayError(null);
      announceWorkspace(t("app.stopRequested"));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setGatewayError(messageText);
      setSessionActionError(`${t("app.stopFailed")}: ${messageText}`);
      setGatewayStatusText(`${t("app.stopFailed")}: ${messageText}`);
    } finally {
      setSessionActionBusy(null);
    }
  }, [activeConversation?.runtime?.activeRunId, activeConversationId, activeConversationSending, announceWorkspace]);

  const handleCopySessionKey = useCallback(async (conversationId: string) => {
    setSessionActionError(null);
    try {
      await navigator.clipboard.writeText(conversationId);
      announceWorkspace(t("app.sessionIdCopied"));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setSessionActionError(`${t("app.copyFailed")}: ${messageText}`);
    }
  }, [announceWorkspace]);

  const handleCompactSession = useCallback(async (conversationId: string) => {
    const target = findConversationById(agentsRef.current, conversationId);
    if (target?.isDraft) {
      setSessionActionError(t("app.draftConversationCompactionHint"));
      return;
    }
    setSessionActionBusy("compact");
    setSessionActionError(null);
    try {
      await invoke("gateway_connect");
      await invoke("gateway_sessions_compact", { params: { sessionKey: conversationId } });
      announceWorkspace(t("app.contextCompacted"));
      if (activeConversationIdRef.current === conversationId) {
        await openConversationDetail(conversationId, true);
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setSessionActionError(`${t("app.compactContextFailed")}: ${messageText}`);
    } finally {
      setSessionActionBusy(null);
    }
  }, [announceWorkspace]);

  const handleResetSession = useCallback(async (conversationId: string) => {
    const target = findConversationById(agentsRef.current, conversationId);
    const label = target?.title ?? conversationId;
    const confirmed = shouldRunDestructiveAction(
      clawKitSettings.general.confirmDestructiveActions,
      () => window.confirm(`${t("app.restartConfirmTitle")} "${label}"?\n\n${t("app.restartConfirmBody")}`),
    );
    if (!confirmed) return;
    setSessionActionBusy("reset");
    setSessionActionError(null);
    try {
      if (target?.isDraft) {
        setAgents((current) => current.map((agent) => ({
          ...agent,
          conversations: agent.conversations.map((conversation) =>
            conversation.id === conversationId
              ? { ...conversation, previewMessages: [], lastMessage: "", tokens: "--", status: "idle" }
              : conversation,
          ),
        })));
        announceWorkspace(t("app.draftConversationCleared"));
        return;
      }
      await invoke("gateway_connect");
      await invoke("gateway_sessions_reset", { params: { sessionKey: conversationId } });
      setAgents((current) => current.map((agent) => ({
        ...agent,
        conversations: agent.conversations.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, previewMessages: [], lastMessage: "", tokens: "--", status: "idle" }
            : conversation,
        ),
      })));
      announceWorkspace(t("app.conversationRestarted"));
      if (activeConversationIdRef.current === conversationId) {
        await openConversationDetail(conversationId, true);
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setSessionActionError(`${t("app.restartFailed")}: ${messageText}`);
    } finally {
      setSessionActionBusy(null);
    }
  }, [announceWorkspace, clawKitSettings.general.confirmDestructiveActions]);

  const handleDeleteSession = useCallback(async (conversationId: string) => {
    const target = findConversationById(agentsRef.current, conversationId);
    const label = target?.title ?? conversationId;
    const confirmed = shouldRunDestructiveAction(
      clawKitSettings.general.confirmDestructiveActions,
      () => window.confirm(`${t("app.deleteConfirmTitle")} "${label}"?\n\n${t("app.deleteConfirmBody")}`),
    );
    if (!confirmed) return;
    setSessionActionBusy("delete");
    setSessionActionError(null);
    try {
      if (!target?.isDraft) {
        await invoke("gateway_connect");
        await invoke("gateway_sessions_delete", { params: { sessionKey: conversationId } });
      }
      setAgents((current) => current.map((agent) => ({
        ...agent,
        conversations: agent.conversations.filter((conversation) => conversation.id !== conversationId),
      })));
      setOpenedConversationIds((current) => {
        const next = { ...current };
        delete next[conversationId];
        return next;
      });
      if (expandedConversationId === conversationId) {
        setExpandedConversationId("");
      }
      if (activeConversationIdRef.current === conversationId) {
        setActiveConversationId(null);
      }
      announceWorkspace(t("app.conversationDeleted"));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setSessionActionError(`${t("app.deleteFailed")}: ${messageText}`);
    } finally {
      setSessionActionBusy(null);
    }
  }, [announceWorkspace, clawKitSettings.general.confirmDestructiveActions, expandedConversationId]);

  const handleSend = useCallback(async () => {
    if (!activeConversationId) return;
    const message = composerValue.trim();
    const attachments = composerAttachments;
    if (!message && attachments.length === 0) return;

    const shouldQueue = activeConversationSending;
    setComposerValue("");
    setComposerAttachments([]);

    if (shouldQueue) {
      enqueueComposerMessage(activeConversationId, message, attachments);
      return;
    }

    suppressSessionRefreshUntilRef.current = 0;
    await sendMessageToConversation(activeConversationId, message, attachments, {
      restoreToComposerOnError: true,
      model: composerModel,
      thinking: composerThinking,
    });
  }, [activeConversationId, activeConversationSending, composerAttachments, composerModel, composerThinking, composerValue, enqueueComposerMessage, sendMessageToConversation]);

  useEffect(() => {
    if (!activeConversationId || !activeConversation) return;
    if (activeConversationSending) return;
    const nextQueuedMessage = queuedMessagesByConversation[activeConversationId]?.[0];
    if (!nextQueuedMessage) return;
    if (autoSendingQueuedMessageRef.current === nextQueuedMessage.id) return;

    autoSendingQueuedMessageRef.current = nextQueuedMessage.id;
    const remainingQueuedMessages = (queuedMessagesByConversationRef.current[activeConversationId] ?? []).filter((item) => item.id !== nextQueuedMessage.id);
    setQueuedMessagesByConversation((current) => ({
      ...current,
      [activeConversationId]: remainingQueuedMessages,
    }));
    const queuedPayload = nextQueuedMessage;
    window.setTimeout(() => {
      suppressSessionRefreshUntilRef.current = 0;
      void sendMessageToConversation(activeConversationId, queuedPayload.text, queuedPayload.attachments, {
        requeueOnError: queuedPayload,
        model: queuedPayload.model,
        thinking: queuedPayload.thinking,
      })
        .finally(() => {
          if (autoSendingQueuedMessageRef.current === queuedPayload.id) {
            autoSendingQueuedMessageRef.current = null;
          }
        });
    }, 180);
  }, [activeConversation, activeConversationId, activeConversationSending, queuedMessagesByConversation, sendMessageToConversation]);




  const bootstrapScreen = (
    <BootstrapScreens
      t={t}
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

  const appearanceDataAttributes = buildAppearanceDataAttributes(clawKitSettings.appearance, systemTheme);

  return (
    <main className="app-shell" {...appearanceDataAttributes}>
      <GatewayBanner connected={gatewayConnected} statusText={gatewayStatusText} error={gatewayError} t={t} />
      <ImageLightbox src={previewImageSrc} onClose={() => setPreviewImageSrc(null)} t={t} />
      <MandatoryAppUpdateModal
        open={clawKitSelfUpdate.mandatoryUpdateOpen}
        version={clawKitSelfUpdate.pendingVersion}
        installing={clawKitSelfUpdate.installingUpdate}
        onApply={() => void clawKitSelfUpdate.applyPendingUpdate()}
        t={t}
      />
      <AgentCreateDialog
        t={t}
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
        t={t}
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
          t={t}
          gatewayConnected={gatewayConnected}
          gatewayVersion={openClawStatus?.runtimeVersion}
          updateAvailable={openClawCliStatus?.updateAvailable}
          sessionCount={openClawStatus?.sessions?.count}
          onOpenStatus={toggleOpenClawInfo}
          clawKitUpdateReady={clawKitSelfUpdate.showOptionalUpdateChrome}
          clawKitUpdateInstalling={clawKitSelfUpdate.installingUpdate}
          onApplyClawKitUpdate={() => void clawKitSelfUpdate.applyPendingUpdate()}
        />

        {activeNav === "conversations" ? (
          <>
            <ResourceSidebar
              t={t}
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
              t={t}
              defaultDisplayMode={clawKitSettings.general.defaultConversationMode}
              sendShortcut={clawKitSettings.general.sendShortcut}
              visibleConversationCount={visibleConversations.length}
              conversationFiltersActive={conversationFiltersActive}
              onClearConversationFilters={handleClearConversationFilters}
              workspaceAnnouncement={workspaceAnnouncement}
              activeConversation={activeConversation}
              visibleConversations={visibleConversations}
              filteredVisibleConversations={filteredVisibleConversations}
              conversationSearch={conversationSearch}
              conversationRuntimeFilter={conversationRuntimeFilter}
              conversationRuntimeOptions={conversationRuntimeOptions}
              conversationSort={conversationSort}
              statusLabel={localizedStatusLabel}
              userExpanded={userExpanded}
              aiResponseScrollRef={aiResponseScrollRef}
              showJumpToBottom={showJumpToBottom}
              shouldStickToBottomRef={shouldStickToBottomRef}
              composerFocused={composerFocused}
              composerValue={composerValue}
              composerModel={composerModel}
              composerThinking={composerThinking}
              sending={activeConversationSending}
              composerAttachments={composerAttachments}
              activeQueuedMessages={activeQueuedMessages}
              gatewayError={activeSendError}
              modelOptions={modelOptions}
              modelsLoading={modelsLoading}
              composerThinkingOptions={composerThinkingOptions}
              onBack={handleBackToConversationList}
              onUserExpandedChange={setUserExpanded}
              onJumpToBottomHidden={() => setShowJumpToBottom(false)}
              onUpdateTitle={handleUpdateConversationTitle}
              parseSenderMeta={parseSenderMeta}
              onOpenImage={setPreviewImageSrc}
              formatTokenCount={formatTokenCount}
              onOpenConversation={openConversationDetail}
              onHideConversation={handleHideConversation}
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
              sessionOverrideResetEnabled={sessionOverrideResetEnabled}
              onResetThinkingDefault={handleResetComposerThinkingDefault}
              onResetFastDefault={handleResetComposerFastDefault}
              sessionActionBusy={sessionActionBusy}
              sessionActionError={sessionActionError}
              onCopySessionKey={handleCopySessionKey}
              onCompactSession={handleCompactSession}
              onResetSession={handleResetSession}
              onDeleteSession={handleDeleteSession}
            />
          </>
        ) : null}

        {activeNav === "models" ? (
          <Suspense fallback={lazyPageFallback}>
            <ModelsPage
              t={t}
              configuredModels={modelsPageReady ? configuredModels : []}
              allModels={modelsPageReady ? allModels : []}
              authStatus={modelsPageReady ? modelAuthStatus : null}
              loading={modelsPageLoading || !modelsPageReady}
              currentDefaultModel={currentDefaultModel}
              actionBusy={modelActionBusy}
              message={modelsActionMessage}
              onRefresh={() => void refreshModelsPage({ refreshAuth: true })}
              onSetDefault={(modelRef) => void handleSetDefaultModel(modelRef)}
              onAuthProvider={(provider, setDefault) => void handleModelAuthProvider(provider, setDefault)}
              onSaveProviderConfig={(draft) => void handleSaveProviderConfig(draft)}
              onSaveModelConfig={(draft) => void handleSaveModelConfig(draft)}
            />
          </Suspense>
        ) : null}

        {activeNav === "skills" ? (
          <Suspense fallback={lazyPageFallback}>
            <SkillsPage
              skills={metadataPageReady ? skills : []}
              pluginLoadRepairs={metadataPageReady ? pluginLoadRepairs : []}
              loading={metadataLoading || !metadataPageReady}
              t={t}
              onToggleSkill={(skillId, enabled) => void handleToggleSkill(skillId, enabled)}
            />
          </Suspense>
        ) : null}

        {activeNav === "connections" ? (
          <Suspense fallback={lazyPageFallback}>
            <ConnectionsPage
              connections={metadataPageReady ? connections : []}
              connectionLabel={connectionLabel}
              eventLoopHealth={metadataPageReady ? channelEventLoopHealth : null}
              unmatchedPluginRepairs={metadataPageReady ? unmatchedPluginRepairs : []}
              loading={metadataLoading || !metadataPageReady}
              gatewayConnected={gatewayConnected}
              weixinStatus={weixinStatus}
              weixinBusy={weixinBusy}
              weixinMessage={weixinMessage}
              qqbotBusy={qqbotBusy}
              qqbotStatusBusy={qqbotStatusBusy}
              qqbotNotice={qqbotNotice}
              qqbotPluginRegistered={Boolean(qqbotStatus?.installed)}
              qqbotStatus={qqbotStatus}
              t={t}
              onRefreshWeixinStatus={() => void refreshWeixinPluginStatus()}
              onEnableWeixin={() => void ensureWeixinPluginEnabled()}
              onInstallWeixin={() => void runWeixinTerminalAction("open_weixin_plugin_install_terminal")}
              onUpdateWeixin={() => void runWeixinTerminalAction("open_weixin_plugin_update_terminal")}
              onLoginWeixin={() => void runWeixinTerminalAction("open_weixin_login_terminal")}
              onInstallQqbotPlugin={() => void runQqbotPluginInstall()}
              onRefreshQqbotStatus={() => void refreshQqbotPluginStatus()}
              onLoadQqbotEditorForm={loadQqbotEditorForm}
              onSaveQqbotSettings={(form) => void saveQqbotSettings(form)}
              onDismissQqbotNotice={() => setQqbotNotice(null)}
            />
          </Suspense>
        ) : null}

        {activeNav === "cron" ? (
          <Suspense fallback={lazyPageFallback}>
            <CronPage
              gatewayConnected={gatewayConnected}
              onOpenSessionKey={handleOpenCronSessionKey}
              t={t}
            />
          </Suspense>
        ) : null}

        {activeNav === "usage" ? (
          <Suspense fallback={lazyPageFallback}>
            <UsagePage usage={usagePageReady ? usage : null} loading={usageLoading || !usagePageReady} t={t} />
          </Suspense>
        ) : null}

        {activeNav === "pets" ? (
          <Suspense fallback={lazyPageFallback}>
            <PetsPage context={petContext} t={t} />
          </Suspense>
        ) : null}

        {activeNav === "settings" ? (
          <Suspense fallback={lazyPageFallback}>
            <SettingsPage
              settings={clawKitSettings}
              loading={clawKitSettingsLoading}
              error={clawKitSettingsError}
              t={t}
              patchSettings={patchSettings}
              gatewayConnected={gatewayConnected}
              gatewayStatusText={gatewayStatusText}
              bootstrapStatus={bootstrapStatus}
              openClawCliStatus={openClawCliStatus}
              actionBusy={settingsOpenClawActionBusy || openClawGatewayBusy || openClawUpdateBusy || bindingInProgress}
              actionMessage={settingsOpenClawActionMessage ?? openClawGatewayMessage ?? openClawUpdateMessage}
              onRefreshOpenClaw={refreshSettingsOpenClawStatus}
              onReconnectGateway={reconnectSettingsGateway}
              onToggleGateway={() => void toggleOpenClawGateway()}
              onRepairBinding={repairSettingsBinding}
              onInstallOpenClaw={installOpenClawFromSettings}
              onUpdateOpenClaw={() => void runOpenClawUpdate()}
              onNavigate={handleNavChange}
              patchOpenClawConfig={patchOpenClawConfig}
            />
          </Suspense>
        ) : null}
      </div>

      <OpenClawInfoDrawer
        open={openClawInfoOpen}
        t={t}
        gatewayConnected={gatewayConnected}
        gatewayStatusText={gatewayStatusText}
        openClawGatewayBusy={openClawGatewayBusy}
        onClose={() => setOpenClawInfoOpen(false)}
        onToggleGateway={() => void toggleOpenClawGateway()}
        openClawStatus={openClawStatus}
        gatewayProcessUptimeLabel={gatewayProcessUptimeLabel}
        gatewayRestartSentinelLine={gatewayRestartSentinelLine}
        uiFrameDiagnostics={uiFrameDiagnostics}
        openClawCliStatus={openClawCliStatus}
        openClawUpdateMessage={openClawUpdateMessage}
        openClawGatewayMessage={openClawGatewayMessage}
        openClawUpdateBusy={openClawUpdateBusy}
        onRunOpenClawUpdate={() => void runOpenClawUpdate()}
        onOpenLocalOpenClaw={() => void openLocalOpenClaw()}
      />
    </main>
  );
}

export default App;
