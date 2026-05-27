import { buildSkillPolicyHints } from "./skillPolicyHints";
import {
  interpretPluginHealthError,
  mergePluginRepairsIntoConnections,
  parseHealthPluginErrors,
} from "./pluginPackagingDiagnostics";
import { resolveChannelHealthHint, resolveChannelOperationalDegraded } from "./channelHealth";
import { isConversationRunning } from "./conversationRunState";
import { resolveGatewayChannelStatusIds } from "./gatewayChannelStatusIds";
import type { Agent, ChannelConnection, ClawKitBootstrapStatus, PluginRepairCard, Skill } from "../types/app";
import type { Conversation } from "../types/conversation";
import type { PetConversationContext } from "../types/pet";
import type {
  GatewayChannelsEventLoopHealth,
  GatewayChannelsStatusResult,
  GatewaySkillsStatusResult,
} from "../types/gateway";

const PET_COMPLETED_VISIBLE_MS = 10 * 1000;
const PET_REPLY_MAX_AGE_MS = 5 * 60 * 1000;
const PET_ACTIVE_EVENT_TYPES = new Set([
  "running",
  "started",
  "tool_stream",
  "assistant_stream",
  "delta",
  "tool_call",
  "tool_result",
]);

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

export function buildBootstrapDebugStatus(step: "install" | "bind" | "connect_test"): ClawKitBootstrapStatus {
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

export function resolveConfigDefaultModel(config: unknown): string | null {
  const modelPrimary = readNestedString(config, ["agents", "defaults", "model", "primary"]);
  if (modelPrimary) return modelPrimary;
  const model = readNestedString(config, ["agents", "defaults", "model"]);
  if (model) return model;
  const defaultModels = readNestedRecord(config, ["agents", "defaults", "models"]);
  const firstConfiguredDefault = defaultModels ? Object.keys(defaultModels).find((key) => key.trim()) : null;
  return firstConfiguredDefault ?? null;
}

export function normalizePetTimestamp(value?: number) {
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

function resolvePetToolProgress(conversation: Conversation | null): string | null {
  if (!conversation) return null;
  const messages = conversation.previewMessages ?? [];
  const latestAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && Array.isArray(message.parts) && message.parts.length > 0);
  if (!latestAssistant?.parts?.length) return null;
  const latestPart = [...latestAssistant.parts]
    .reverse()
    .find((part) => part.kind === "tool_call" || part.kind === "tool_result");
  if (!latestPart) return null;
  if (latestPart.kind === "tool_call") {
    const toolName = latestPart.tool?.trim() || "tool";
    return `Tool call: ${toolName}`;
  }
  const output = latestPart.text?.replace(/\s+/g, " ").trim();
  return output ? `Tool result: ${output.slice(0, 88)}` : "Tool call returned";
}

function resolvePetLastUserMessage(conversation: Conversation | null): string | null {
  if (!conversation) return null;
  const messages = conversation.previewMessages ?? [];
  const runStartedAt = resolvePetRunStartedAt(conversation);
  const terminalAt = normalizePetTimestamp(conversation.runtime?.lastTerminalAt);
  const users = [...messages]
    .reverse()
    .filter((message) => message.role === "user" && message.text.trim());
  if (users.length === 0) return null;
  if (!runStartedAt) return users[0]?.text.trim() || null;
  const currentRunUser = users.find((message) => {
    const messageTime = normalizePetTimestamp(message.timestamp);
    return typeof messageTime === "number"
      && messageTime >= runStartedAt - 1000
      && (!terminalAt || messageTime <= terminalAt + 1000);
  });
  return currentRunUser?.text.trim() || users[0]?.text.trim() || null;
}

function conversationHasActivePetReply(conversation: Conversation, now: number) {
  if (
    isConversationRunning(conversation)
    || PET_ACTIVE_EVENT_TYPES.has((conversation.latestEventType ?? "").toLowerCase())
  ) return true;
  const completedAt = normalizePetTimestamp(conversation.runtime?.lastTerminalAt ?? conversation.updatedAt);
  return conversation.status === "completed"
    && typeof completedAt === "number"
    && now - completedAt <= PET_COMPLETED_VISIBLE_MS;
}

export function buildPetContext(agents: Agent[], conversation: Conversation | null, now: number): PetConversationContext {
  const activeReplies = agents
    .flatMap((agent) => agent.conversations)
    .filter((item) => conversationHasActivePetReply(item, now))
    .map((item) => {
      const reply = resolvePetLastReply(item);
      const eventType = (item.latestEventType ?? "").toLowerCase();
      const activeByEventType = PET_ACTIVE_EVENT_TYPES.has(eventType);
      const isActive = isConversationRunning(item) || activeByEventType;
      const toolProgress = resolvePetToolProgress(item);
      return {
        conversationId: item.id,
        title: item.title,
        userMessage: resolvePetLastUserMessage(item),
        status: item.status,
        model: item.model,
        reply: reply ?? toolProgress ?? "",
        loading: isActive,
        updatedAt: normalizePetTimestamp(item.runtime?.lastEventAt ?? item.runtime?.lastTerminalAt ?? item.updatedAt) ?? null,
      };
    })
    .filter((item) => item.loading || item.reply.trim())
    .filter((item) => typeof item.updatedAt === "number" && now - item.updatedAt <= PET_REPLY_MAX_AGE_MS)
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

export function mapGatewaySkills(result: GatewaySkillsStatusResult): Skill[] {
  return (result.skills ?? []).map((skill) => ({
    id: skill.skillKey ?? skill.name,
    name: [skill.emoji, skill.name].filter(Boolean).join(" "),
    summary: skill.description ?? "No skill description yet.",
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

function mapGatewayChannels(result: GatewayChannelsStatusResult): {
  connections: ChannelConnection[];
  eventLoop?: GatewayChannelsEventLoopHealth;
} {
  const ids = resolveGatewayChannelStatusIds(result);
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
      activity: connected ? "Running" : configured ? "Configured, waiting for connection" : "Pending configuration",
      healthHint,
      packageName:
        id === "openclaw-weixin"
          ? "@tencent-weixin/openclaw-weixin"
          : id === "qqbot"
            ? "@openclaw/qqbot"
            : undefined,
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

export function applyPluginHealthToChannels(
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
