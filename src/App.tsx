import { startTransition, useEffect, useMemo, useState, useCallback, useRef } from "react";
import { defaultWindowIcon } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GatewayBanner, ImageLightbox, NavSidebar } from "./components/AppChrome";
import { MandatoryAppUpdateModal } from "./components/MandatoryAppUpdateModal";
import { AgentCreateDialog } from "./components/AgentCreateDialog";
import { AgentFilesDialog } from "./components/AgentFilesDialog";
import { BootstrapScreens } from "./components/BootstrapScreens";
import { ConversationWorkspace } from "./components/ConversationWorkspace";
import { CronPage } from "./components/CronPage";
import { OpenClawUiDiagnostics } from "./components/OpenClawUiDiagnostics";
import { ConnectionsPage, SkillsPage, UsagePage } from "./components/InfoPages";
import { ModelsPage } from "./components/ModelsPage";
import { PetsPage } from "./components/PetsPage";
import { ResourceSidebar } from "./components/ResourceSidebar";
import { SettingsPage } from "./components/SettingsPage";
import { getLastAssistantMessage, mapGatewayHistoryMessages, resolveConversationDefaultModel as resolveConversationModel, summarizeMessageUsage } from "./lib/conversationHistory";
import { conversationMatchesSessionKey, findConversationById, getVisibleConversations } from "./lib/conversationSelectors";
import { readComposerAttachments } from "./lib/composerAttachments";
import { useConversationAutoScroll } from "./hooks/useConversationAutoScroll";
import { useClawKitSettings } from "./hooks/useClawKitSettings";
import { useClawKitSelfUpdate } from "./hooks/useClawKitSelfUpdate";
import { useGatewayChat } from "./hooks/useGatewayChat";
import { useGatewaySnapshot } from "./hooks/useGatewaySnapshot";
import { useMessageSender } from "./hooks/useMessageSender";
import { useModels } from "./hooks/useModels";
import { useUiFrameDiagnostics } from "./hooks/useUiFrameDiagnostics";
import { buildAgentsFromSnapshot, hasActiveAgentRun, mergeGatewaySessionRowsIntoAgents, patchConversation, resolveAgentDefaultModel } from "./lib/agentsSnapshot";
import { connectionLabel, formatTokenCount, statusLabel } from "./lib/appFormatters";
import { buildSkillPolicyHints } from "./lib/skillPolicyHints";
import {
  interpretPluginHealthError,
  mergePluginRepairsIntoConnections,
  parseHealthPluginErrors,
} from "./lib/pluginPackagingDiagnostics";
import { resolveChannelHealthHint, resolveChannelOperationalDegraded } from "./lib/channelHealth";
import { parseSenderMeta } from "./lib/messageMeta";
import { buildModelOptions, canonicalizeModelRef } from "./lib/modelOptions";
import { mergeSnapshotMessagesPreservingCurrentOrder } from "./lib/toolStream";
import { isInternalOpenClawMessage } from "./lib/gatewayMessages";
import { describeUpdateRestartSentinel, extrapolateGatewayUptimeMs, formatApproxDurationMs } from "./lib/gatewayRuntimeInfo";
import { resolveComposerThinkingOptions } from "./lib/thinkingOptions";
import { buildAppearanceDataAttributes } from "./lib/appAppearance";
import { buildConversationCompletionNotification } from "./lib/conversationNotifications";
import { onNativeNotificationAction, sendNativeNotification } from "./lib/notifications";
import { createTranslator, resolveLocale } from "./lib/i18n";
import { shouldRunDestructiveAction } from "./lib/sessionConfirmations";
import { parseConversationFilters, serializeConversationFilters } from "./lib/appUiPersistence";
import type { Conversation, ConversationRuntime, PreviewMessage } from "./types/conversation";
import type { PetConversationContext } from "./types/pet";
import type { Agent, ChannelConnection, ClawKitBootstrapStatus, ComposerAttachment, NavKey, OpenClawCliStatus, PluginRepairCard, QueuedComposerMessage, Skill, WeixinPluginStatus } from "./types/app";
import type { GatewayAgentsCreateResult, GatewayAgentsUpdateResult, GatewayChannelsEventLoopHealth, GatewayChannelsStatusResult, GatewayConfigGetResult, GatewayConfigPatchResult, GatewayHistoryResult, GatewayModelAuthStatusResult, GatewayModelSummary, GatewayModelsResult, GatewayOpenClawStatusResult, GatewaySessionsListResult, GatewaySessionsUsageResult, GatewaySkillsStatusResult, GatewaySkillsUpdateResult, GatewayStatus, GatewayUpdateStatusResult, OpenClawSnapshot } from "./types/gateway";
import type { RealtimeGatewayEvent, RealtimeSessionMessageEvent } from "./realtime";
import "./App.css";

const agentsSeed: Agent[] = [];
const fallbackSkills: Skill[] = [];
const fallbackConnections: ChannelConnection[] = [];
const RECENT_CONVERSATION_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const OPENCLAW_VERSION_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const BOOTSTRAP_DEBUG_STORAGE_KEY = "clawkit.debug.bootstrapStep";
const CONVERSATION_FILTERS_STORAGE_KEY = "clawkit.conversationFilters";
const LAST_CONVERSATION_STORAGE_KEY = "clawkit.lastConversationId";

function readBootstrapDebugStep() {
  try {
    const value =
      window.localStorage.getItem(BOOTSTRAP_DEBUG_STORAGE_KEY) ??
      window.localStorage.getItem("clawx.debug.bootstrapStep");
    return value === "install" || value === "bind" || value === "connect_test" ? value : null;
  } catch {
    return null;
  }
}

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
    await appWindow.requestUserAttention(UserAttentionType.Informational).catch(() => undefined);
  } catch (error) {
    console.warn("Failed to bring ClawKit window forward", error);
  }
}

function buildBootstrapDebugStatus(step: "install" | "bind" | "connect_test"): ClawKitBootstrapStatus {
  const base: ClawKitBootstrapStatus = {
    openclawInstalled: step !== "install",
    openclawPath: step === "install" ? null : "/debug/openclaw",
    configExists: step !== "install",
    configPath: "~/.openclaw/openclaw.json",
    bindingConfigured: step === "connect_test",
    allowedOrigins: [],
    recommendedOrigin: "http://localhost:1420",
    gatewayPort: 18789,
    bindingWrites: [
      "gateway.clients.clawkit.enabled = true",
      "gateway.clients.clawkit.origins += http://localhost:1420",
    ],
  };
  return base;
}
const PET_COMPLETED_VISIBLE_MS = 10 * 1000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readNestedRecord(root: unknown, path: string[]): Record<string, unknown> | null {
  let current: unknown = root;
  for (const key of path) {
    const record = asRecord(current);
    if (!record) return null;
    current = record[key];
  }
  return asRecord(current);
}

function readNestedString(root: unknown, path: string[]): string | null {
  let current: unknown = root;
  for (const key of path) {
    const record = asRecord(current);
    if (!record) return null;
    current = record[key];
  }
  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function resolveConfigDefaultModel(config: unknown): string | null {
  const modelPrimary = readNestedString(config, ["agents", "defaults", "model", "primary"]);
  if (modelPrimary) return modelPrimary;
  const model = readNestedString(config, ["agents", "defaults", "model"]);
  if (model) return model;
  const defaultModels = readNestedRecord(config, ["agents", "defaults", "models"]);
  const firstConfiguredDefault = defaultModels ? Object.keys(defaultModels).find((key) => key.trim()) : null;
  return firstConfiguredDefault ?? null;
}

function normalizePetTimestamp(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value < 10_000_000_000 ? value * 1000 : value;
}

function resolvePetRunStartedAt(conversation: Conversation | null) {
  return normalizePetTimestamp(conversation?.runtime?.activeStartedAt ?? conversation?.runtime?.lastRunStartedAt);
}

function resolvePetLastReply(conversation: Conversation | null): string | null {
  if (!conversation) return null;
  const messages = conversation.previewMessages ?? [];
  const runStartedAt = resolvePetRunStartedAt(conversation);
  const terminalAt = normalizePetTimestamp(conversation.runtime?.lastTerminalAt);
  const assistant = [...messages].reverse().find((message) => {
    if (message.role !== "assistant" || !message.text.trim()) return false;
    if (!runStartedAt) return true;
    const messageTime = normalizePetTimestamp(message.timestamp);
    return typeof messageTime === "number"
      && messageTime >= runStartedAt - 1000
      && (!terminalAt || messageTime <= terminalAt + 1000);
  });
  if (runStartedAt) return assistant?.text.trim() || (conversation.lastRole === "assistant" ? conversation.lastMessage : null) || null;
  const fallback = conversation.lastRole === "assistant" ? conversation.lastMessage : null;
  return assistant?.text.trim() || fallback || null;
}

function resolvePetLastUserMessage(conversation: Conversation | null): string | null {
  if (!conversation) return null;
  const messages = conversation.previewMessages ?? [];
  const user = [...messages].reverse().find((message) => message.role === "user" && message.text.trim());
  return user?.text.trim() || null;
}

function conversationHasActivePetReply(conversation: Conversation, now: number) {
  if (conversation.runtime?.activeRunId || conversation.status === "working") return true;
  const completedAt = normalizePetTimestamp(conversation.runtime?.lastTerminalAt ?? conversation.updatedAt);
  return conversation.status === "completed"
    && typeof completedAt === "number"
    && now - completedAt <= PET_COMPLETED_VISIBLE_MS;
}

function buildPetContext(agents: Agent[], conversation: Conversation | null, now: number): PetConversationContext {
  const activeReplies = agents
    .flatMap((agent) => agent.conversations)
    .filter((item) => conversationHasActivePetReply(item, now))
    .map((item) => {
      const reply = resolvePetLastReply(item);
      return {
        conversationId: item.id,
        title: item.title,
        userMessage: resolvePetLastUserMessage(item),
        status: item.status,
        model: item.model,
        reply: reply ?? "",
        loading: !reply && (Boolean(item.runtime?.activeRunId) || item.status === "working"),
        updatedAt: item.runtime?.lastEventAt ?? item.runtime?.lastTerminalAt ?? item.updatedAt ?? null,
      };
    })
    .filter((item) => item.loading || item.reply.trim())
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));

  return {
    conversationId: conversation?.id ?? null,
    title: conversation?.title ?? null,
    status: conversation?.status ?? "idle",
    model: conversation?.model ?? null,
    lastUserMessage: resolvePetLastUserMessage(conversation),
    lastReply: resolvePetLastReply(conversation),
    updatedAt: conversation?.updatedAt ?? null,
    tokens: conversation?.tokens ?? null,
    replies: activeReplies,
  };
}

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
    policyHints: buildSkillPolicyHints({
      name: skill.name,
      blockedByAllowlist: skill.blockedByAllowlist,
      blockedByAgentFilter: skill.blockedByAgentFilter,
      eligible: skill.eligible,
      install: skill.install,
    }),
  }));
}

function applyPluginHealthToChannels(
  channelsResult: GatewayChannelsStatusResult,
  healthRaw: unknown,
): {
  connections: ChannelConnection[];
  eventLoop?: GatewayChannelsEventLoopHealth;
  repairs: PluginRepairCard[];
  unmatched: PluginRepairCard[];
} {
  const pluginErrors = parseHealthPluginErrors(healthRaw);
  const repairCards = pluginErrors.map(interpretPluginHealthError);
  const channelPayload = mapGatewayChannels(channelsResult);
  const merged = mergePluginRepairsIntoConnections(channelPayload.connections, repairCards);
  return {
    connections: merged.connections,
    eventLoop: channelPayload.eventLoop,
    repairs: repairCards,
    unmatched: merged.unmatchedRepairs,
  };
}

function mapGatewayChannels(result: GatewayChannelsStatusResult): {
  connections: ChannelConnection[];
  eventLoop?: GatewayChannelsEventLoopHealth;
} {
  const ids = result.channelOrder ?? Object.keys(result.channels ?? {});
  const connections = ids.map((id) => {
    const accounts = result.channelAccounts?.[id] ?? [];
    const connected = accounts.some((account) => account.connected || account.running);
    const configured = accounts.some((account) => account.configured || account.enabled);
    const error = accounts.find((account) => account.lastError)?.lastError;
    const degradedOperational = resolveChannelOperationalDegraded(accounts);
    const healthHint = resolveChannelHealthHint(accounts);

    let status: ChannelConnection["status"];
    if (connected) {
      status = degradedOperational ? "degraded" : "connected";
    } else if (error) {
      status = "warning";
    } else if (configured) {
      status = "warning";
    } else {
      status = "disabled";
    }

    const label = result.channelLabels?.[id] ?? result.channelMeta?.find((item) => item.id === id)?.label ?? id;
    const detail = result.channelDetailLabels?.[id] ?? result.channelMeta?.find((item) => item.id === id)?.detailLabel ?? "OpenClaw Gateway channel";
    return {
      id,
      name: label,
      status,
      detail: error ? `${detail}：${error}` : detail,
      config: `channels.${id}`,
      activity: connected ? "运行中" : configured ? "已配置，等待连接" : "待配置",
      healthHint,
      packageName: id === "openclaw-weixin" ? "@tencent-weixin/openclaw-weixin" : undefined,
      docsUrl: `https://docs.openclaw.ai/channels/${id}`,
      accounts: accounts.map((account) => ({
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        linked: account.linked,
        connected: account.connected,
        running: account.running,
        lastError: account.lastError,
        healthState: account.healthState,
        tokenSource: account.tokenSource,
        botTokenSource: account.botTokenSource,
        appTokenSource: account.appTokenSource,
        signingSecretSource: account.signingSecretSource,
        tokenStatus: account.tokenStatus,
        botTokenStatus: account.botTokenStatus,
        appTokenStatus: account.appTokenStatus,
        signingSecretStatus: account.signingSecretStatus,
        userTokenStatus: account.userTokenStatus,
        statusState: account.statusState,
      })),
    };
  });
  return { connections, eventLoop: result.eventLoop };
}

function App() {
  const [bootstrapStatus, setBootstrapStatus] = useState<ClawKitBootstrapStatus | null>(null);
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
  const [gatewaySessionsDefaults, setGatewaySessionsDefaults] = useState<GatewaySessionsListResult["defaults"] | null>(null);
  const [openClawStatus, setOpenClawStatus] = useState<GatewayOpenClawStatusResult | null>(null);
  const [openClawConfigDefaultModel, setOpenClawConfigDefaultModel] = useState<string | null>(null);
  const [openClawConfigDefaultModelLoaded, setOpenClawConfigDefaultModelLoaded] = useState(false);
  const [openClawCliStatus, setOpenClawCliStatus] = useState<OpenClawCliStatus | null>(null);
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
  const currentDefaultModel = openClawStatus?.sessions?.defaults?.model ?? gatewaySessionsDefaults?.model ?? openClawConfigDefaultModel ?? null;
  const { modelOptions, modelsLoading, setModelOptions } = useModels({
    enabled: bootstrapStep === "ready" && openClawConfigDefaultModelLoaded,
    defaultModel: currentDefaultModel,
  });
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
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [gatewayStatusText, setGatewayStatusText] = useState("Gateway 连接中...");
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
  const locale = useMemo(
    () => resolveLocale(clawKitSettings.general.language, typeof navigator !== "undefined" ? navigator.language : null),
    [clawKitSettings.general.language],
  );
  const t = useMemo(() => createTranslator(locale), [locale]);
  const clawKitSelfUpdate = useClawKitSelfUpdate(
    bootstrapStep === "ready" && !clawKitSettingsLoading && clawKitSettings.general.autoCheckUpdates,
  );
  const [gatewayUpdateRestartSentinel, setGatewayUpdateRestartSentinel] = useState<unknown>(null);
  const [gatewayRuntimeTick, setGatewayRuntimeTick] = useState(0);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const [userExpanded, setUserExpanded] = useState(false);
  const [workspaceAnnouncement, setWorkspaceAnnouncement] = useState<string | null>(null);
  const [sessionActionBusy, setSessionActionBusy] = useState<string | null>(null);
  const [sessionActionError, setSessionActionError] = useState<string | null>(null);
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

  const loadBootstrapStatus = useCallback(async () => {
    setBootstrapLoading(true);
    setBootstrapError(null);
    try {
      const debugStep = readBootstrapDebugStep();
      if (debugStep) {
        setBootstrapStatus(buildBootstrapDebugStatus(debugStep));
        setBootstrapStep(debugStep);
        return;
      }
      const status = await invoke<ClawKitBootstrapStatus>("get_clawkit_bootstrap_status");
      setBootstrapStatus(status);
      setBootstrapStep(!status.openclawInstalled ? "install" : status.bindingConfigured ? "ready" : "bind");
    } catch (error) {
      console.error("Failed to load clawkit bootstrap status", error);
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
      const status = await invoke<ClawKitBootstrapStatus>("ensure_clawkit_binding");
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
      setWeixinMessage(error instanceof Error ? error.message : "WeChat 插件启用失败");
    } finally {
      setWeixinBusy(false);
    }
  }, [refreshGatewayConnections, refreshWeixinPluginStatus]);

  useEffect(() => {
    void loadBootstrapStatus();
  }, [loadBootstrapStatus]);

  useEffect(() => {
    if (
      autoStartGatewayAttemptedRef.current ||
      clawKitSettingsLoading ||
      !clawKitSettings.openclaw.autoStartGateway ||
      !bootstrapStatus?.openclawInstalled ||
      !bootstrapStatus.bindingConfigured ||
      (bootstrapStep !== "connect_test" && bootstrapStep !== "ready")
    ) {
      return;
    }

    autoStartGatewayAttemptedRef.current = true;
    void (async () => {
      try {
        await invoke("openclaw_gateway_start");
      } catch (error) {
        console.warn("Failed to auto-start OpenClaw Gateway", error);
      }
    })();
  }, [
    bootstrapStatus?.bindingConfigured,
    bootstrapStatus?.openclawInstalled,
    bootstrapStep,
    clawKitSettings.openclaw.autoStartGateway,
    clawKitSettingsLoading,
  ]);

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
  }, [bootstrapStatus?.bindingConfigured, bootstrapStatus?.openclawInstalled, bootstrapStep, loadGatewaySnapshot]);

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

  const gatewayRestartSentinelLine = useMemo(
    () => describeUpdateRestartSentinel(gatewayUpdateRestartSentinel),
    [gatewayUpdateRestartSentinel],
  );

  const refreshGatewayStatus = useCallback(async () => {
    try {
      const status = await invoke<GatewayStatus>("gateway_status");
      setGatewayConnected(status.connected);
      setGatewayStatusText(status.statusText || (status.connected ? "Gateway 已连接" : "Gateway 未连接"));
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
      setGatewayStatusText(`Gateway 状态获取失败: ${message}`);
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

  const refreshOpenClawDefaultModel = useCallback(async () => {
    try {
      await invoke("gateway_connect");
      const configResult = await invoke<GatewayConfigGetResult>("gateway_config_get");
      setOpenClawConfigDefaultModel(resolveConfigDefaultModel(configResult.config));
    } catch (error) {
      console.warn("Failed to load OpenClaw default model", error);
    } finally {
      setOpenClawConfigDefaultModelLoaded(true);
    }
  }, []);

  const refreshOpenClawStatus = useCallback(async () => {
    try {
      await invoke("gateway_connect");
      const [status, updateStatus, configResult] = await Promise.all([
        invoke<GatewayOpenClawStatusResult>("gateway_openclaw_status"),
        invoke<GatewayUpdateStatusResult>("gateway_update_status").catch(() => null),
        invoke<GatewayConfigGetResult>("gateway_config_get").catch(() => null),
      ]);
      setOpenClawStatus(status);
      setOpenClawConfigDefaultModel(resolveConfigDefaultModel(configResult?.config));
      setOpenClawConfigDefaultModelLoaded(true);
      setGatewayUpdateRestartSentinel(updateStatus?.sentinel ?? null);
      await refreshGatewayStatus();
    } catch (error) {
      console.warn("Failed to load OpenClaw runtime status", error);
      setGatewayUpdateRestartSentinel(null);
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
        setModelOptions(buildModelOptions(configuredResult, currentDefaultModel));
      });
      setModelsPageLoading(false);
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
  }, [currentDefaultModel, setModelOptions]);

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
      setOpenClawConfigDefaultModel(modelRef);
      setOpenClawConfigDefaultModelLoaded(true);
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
        setOpenClawConfigDefaultModel(modelRef);
        setOpenClawConfigDefaultModelLoaded(true);
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
        setGatewayUpdateRestartSentinel(null);
        setGatewayUptimeBasisMs(null);
        setGatewayUptimeRecordedAtMs(null);
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

  const runSettingsOpenClawAction = useCallback(async (action: () => Promise<string | void>) => {
    setSettingsOpenClawActionBusy(true);
    setSettingsOpenClawActionMessage(null);
    try {
      const message = await action();
      setSettingsOpenClawActionMessage(message || "操作已执行。");
    } catch (error) {
      setSettingsOpenClawActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSettingsOpenClawActionBusy(false);
    }
  }, []);

  const refreshSettingsOpenClawStatus = useCallback(() => {
    void runSettingsOpenClawAction(async () => {
      await Promise.all([loadBootstrapStatus(), refreshOpenClawCliStatus(), refreshOpenClawStatus()]);
      return "状态已刷新。";
    });
  }, [loadBootstrapStatus, refreshOpenClawCliStatus, refreshOpenClawStatus, runSettingsOpenClawAction]);

  const reconnectSettingsGateway = useCallback(() => {
    void runSettingsOpenClawAction(async () => {
      await invoke("gateway_connect");
      await refreshOpenClawStatus();
      return "Gateway 已重新连接。";
    });
  }, [refreshOpenClawStatus, runSettingsOpenClawAction]);

  const repairSettingsBinding = useCallback(() => {
    void runSettingsOpenClawAction(async () => {
      await bindOpenClaw();
      await loadBootstrapStatus();
      return "ClawKit 绑定已重新写入。";
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
  }, [activeNav, bootstrapStep, openClawConfigDefaultModelLoaded, refreshGatewayConnections, refreshGatewaySkills, refreshModelsPage, refreshUsage, refreshWeixinPluginStatus]);

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
      setWeixinMessage(error instanceof Error ? error.message : "WeChat 操作失败");
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
  });

  const visibleConversations = useMemo(() => getVisibleConversations(agents), [agents]);

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

  const conversationFiltersActive = Boolean(conversationSearch.trim()) || conversationRuntimeFilter !== "all";

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
  const [petClock, setPetClock] = useState(() => Date.now());
  const hasTimedPetReplies = useMemo(
    () => agents.some((agent) => agent.conversations.some((conversation) => conversation.status === "completed" && typeof normalizePetTimestamp(conversation.runtime?.lastTerminalAt ?? conversation.updatedAt) === "number")),
    [agents],
  );
  useEffect(() => {
    if (!hasTimedPetReplies) return;
    const interval = window.setInterval(() => setPetClock(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [hasTimedPetReplies]);
  const petContext = useMemo(() => buildPetContext(agents, activeConversation, petClock), [activeConversation, agents, petClock]);
  const composerThinkingOptions = useMemo(
    () => resolveComposerThinkingOptions(activeConversation ?? null, gatewaySessionsDefaults),
    [activeConversation, gatewaySessionsDefaults],
  );
  const activeConversationRef = useRef<Conversation | null>(null);

  useEffect(() => {
    activeConversationRef.current = activeConversation;
  }, [activeConversation]);

  useEffect(() => {
    localStorage.setItem("clawkit.petContext", JSON.stringify(petContext));
    void emit("clawkit://pet-context", petContext);
  }, [petContext]);

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
        title: "新对话",
        status: "idle",
        lastMessage: "",
        lastTime: new Date().toLocaleString("zh-CN"),
        updatedAt: now,
        tokens: "--",
        model: defaultModel || "未配置",
        thinkingDefault: draftThinkingDefault,
        thinkingOptions: draftThinkingOptions,
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
  }, [agents, gatewaySessionsDefaults, modelOptions]);

  const toggleConversationVisibility = (agentId: string, conversationId: string, visible: boolean) => {
    const conv = findConversationById(agentsRef.current, conversationId);
    const label = conv?.title ?? conversationId;
    if (visible) {
      announceWorkspace(`「${label}」已加入主工作区`);
    } else {
      announceWorkspace(`「${label}」已从主工作区隐藏`);
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
  };

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
      announceWorkspace("已请求停止当前运行");
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setGatewayError(messageText);
      setSessionActionError(`停止失败：${messageText}`);
      setGatewayStatusText(`停止失败: ${messageText}`);
    } finally {
      setSessionActionBusy(null);
    }
  }, [activeConversation?.runtime?.activeRunId, activeConversationId, activeConversationSending, announceWorkspace]);

  const handleCopySessionKey = useCallback(async (conversationId: string) => {
    setSessionActionError(null);
    try {
      await navigator.clipboard.writeText(conversationId);
      announceWorkspace("已复制会话 ID");
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setSessionActionError(`复制失败：${messageText}`);
    }
  }, [announceWorkspace]);

  const handleCompactSession = useCallback(async (conversationId: string) => {
    const target = findConversationById(agentsRef.current, conversationId);
    if (target?.isDraft) {
      setSessionActionError("这还是草稿会话，发送第一条消息后才需要整理上下文。");
      return;
    }
    setSessionActionBusy("compact");
    setSessionActionError(null);
    try {
      await invoke("gateway_connect");
      await invoke("gateway_sessions_compact", { params: { sessionKey: conversationId } });
      announceWorkspace("已整理上下文，长对话会更轻一些");
      if (activeConversationIdRef.current === conversationId) {
        await openConversationDetail(conversationId, true);
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setSessionActionError(`整理上下文失败：${messageText}`);
    } finally {
      setSessionActionBusy(null);
    }
  }, [announceWorkspace]);

  const handleResetSession = useCallback(async (conversationId: string) => {
    const target = findConversationById(agentsRef.current, conversationId);
    const label = target?.title ?? conversationId;
    const confirmed = shouldRunDestructiveAction(
      clawKitSettings.general.confirmDestructiveActions,
      () => window.confirm(`要让「${label}」重新开始吗？\n\n这会清空这段会话的上下文和历史消息，但会保留会话入口。`),
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
        announceWorkspace("草稿会话已清空");
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
      announceWorkspace("会话已重新开始");
      if (activeConversationIdRef.current === conversationId) {
        await openConversationDetail(conversationId, true);
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setSessionActionError(`重新开始失败：${messageText}`);
    } finally {
      setSessionActionBusy(null);
    }
  }, [announceWorkspace, clawKitSettings.general.confirmDestructiveActions]);

  const handleDeleteSession = useCallback(async (conversationId: string) => {
    const target = findConversationById(agentsRef.current, conversationId);
    const label = target?.title ?? conversationId;
    const confirmed = shouldRunDestructiveAction(
      clawKitSettings.general.confirmDestructiveActions,
      () => window.confirm(`确定删除「${label}」吗？\n\n删除后它会从 OpenClaw 会话列表中移除。只是暂时不想看到的话，可以在左侧列表用“隐藏”。`),
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
      announceWorkspace("会话已删除");
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setSessionActionError(`删除失败：${messageText}`);
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
      <GatewayBanner connected={gatewayConnected} statusText={gatewayStatusText} error={gatewayError} />
      <ImageLightbox src={previewImageSrc} onClose={() => setPreviewImageSrc(null)} />
      <MandatoryAppUpdateModal
        open={clawKitSelfUpdate.mandatoryUpdateOpen}
        version={clawKitSelfUpdate.pendingVersion}
        installing={clawKitSelfUpdate.installingUpdate}
        onApply={() => void clawKitSelfUpdate.applyPendingUpdate()}
        t={t}
      />
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
              defaultDisplayMode={clawKitSettings.general.defaultConversationMode}
              sendShortcut={clawKitSettings.general.sendShortcut}
              visibleConversationCount={visibleConversations.length}
              conversationFiltersActive={conversationFiltersActive}
              onClearConversationFilters={() => {
                setConversationSearch("");
                setConversationRuntimeFilter("all");
              }}
              workspaceAnnouncement={workspaceAnnouncement}
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
              sending={activeConversationSending}
              composerAttachments={composerAttachments}
              activeQueuedMessages={activeQueuedMessages}
              gatewayError={activeSendError}
              modelOptions={modelOptions}
              modelsLoading={modelsLoading}
              composerThinkingOptions={composerThinkingOptions}
              onBack={() => setActiveConversationId(null)}
              onUserExpandedChange={setUserExpanded}
              onJumpToBottomHidden={() => setShowJumpToBottom(false)}
              onUpdateTitle={async (conversationId, newTitle) => {
                const trimmed = newTitle.trim();
                const target = agents.flatMap((agent) => agent.conversations).find((conversation) => conversation.id === conversationId);
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
          <ModelsPage
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
        ) : null}

        {activeNav === "skills" ? (
          <SkillsPage
            skills={metadataPageReady ? skills : []}
            pluginLoadRepairs={metadataPageReady ? pluginLoadRepairs : []}
            loading={metadataLoading || !metadataPageReady}
            onToggleSkill={(skillId, enabled) => void handleToggleSkill(skillId, enabled)}
          />
        ) : null}

        {activeNav === "connections" ? (
          <ConnectionsPage
            connections={metadataPageReady ? connections : []}
            connectionLabel={connectionLabel}
            eventLoopHealth={metadataPageReady ? channelEventLoopHealth : null}
            unmatchedPluginRepairs={metadataPageReady ? unmatchedPluginRepairs : []}
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

        {activeNav === "cron" ? (
          <CronPage
            gatewayConnected={gatewayConnected}
            onOpenSessionKey={handleOpenCronSessionKey}
          />
        ) : null}

        {activeNav === "usage" ? (
          <UsagePage usage={usagePageReady ? usage : null} loading={usageLoading || !usagePageReady} />
        ) : null}

        {activeNav === "pets" ? (
          <PetsPage context={petContext} />
        ) : null}

        {activeNav === "settings" ? (
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
          />
        ) : null}
      </div>

      {openClawInfoOpen ? (
        <div className="openclaw-info-backdrop" onMouseDown={() => setOpenClawInfoOpen(false)}>
        <aside
          className="openclaw-info-drawer"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => event.stopPropagation()}
        >
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
            {gatewayConnected && gatewayProcessUptimeLabel ? (
              <div><span>Gateway 运行时长</span><strong title="基于连接握手时的进程 uptime，并随本机时间推算">约 {gatewayProcessUptimeLabel}</strong></div>
            ) : null}
          </div>
          {gatewayConnected && gatewayRestartSentinelLine ? (
            <p className="openclaw-restart-sentinel-hint">{gatewayRestartSentinelLine}</p>
          ) : null}
          <OpenClawUiDiagnostics
            entries={uiFrameDiagnostics.entries}
            capabilities={uiFrameDiagnostics.capabilities}
            onClear={uiFrameDiagnostics.clear}
          />
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
        </div>
      ) : null}
    </main>
  );
}

export default App;
