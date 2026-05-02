import type { MessagePart } from "./conversation";

export type SnapshotSession = {
  id: string;
  agent_id: string;
  key: string;
  title: string;
  label?: string;
  model?: string;
  thinking_default?: string;
  thinking_levels?: Array<{ id: string; label?: string }>;
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

export type OpenClawSnapshot = {
  agents: Array<{ id: string; name: string; workspace?: string; model?: string; agent_dir?: string }>;
  sessions: SnapshotSession[];
  connections: Array<{ id: string; name: string; enabled: boolean }>;
  skills: Array<{ id: string; name: string; location: string }>;
};

export type GatewayStatus = {
  connected: boolean;
  statusText: string;
  error?: string | null;
};

export type GatewayOpenClawStatusResult = {
  runtimeVersion?: string | null;
  channelSummary?: string[];
  sessions?: {
    count?: number;
    defaults?: {
      model?: string | null;
      contextTokens?: number | null;
    };
  };
  heartbeat?: {
    defaultAgentId?: string;
    agents?: Array<{ agentId: string; enabled: boolean; every?: string }>;
  };
};

export type GatewayModelSummary = {
  id: string;
  ref?: string;
  provider?: string;
  name?: string;
  alias?: string;
  label?: string;
  source?: string;
  input?: string[];
  reasoning?: boolean;
  status?: string;
  api?: string;
  baseUrl?: string;
  contextWindow?: number;
  contextTokens?: number;
  maxTokens?: number;
  tags?: string[];
};

export type GatewayModelsResult = {
  models?: GatewayModelSummary[];
};

export type GatewayModelAuthStatusProfile = {
  profileId: string;
  type: "oauth" | "token" | "api_key";
  status: string;
  expiry?: {
    at: number;
    remainingMs: number;
    label: string;
  };
};

export type GatewayModelAuthStatusProvider = {
  provider: string;
  displayName: string;
  status: string;
  profiles: GatewayModelAuthStatusProfile[];
  expiry?: {
    at: number;
    remainingMs: number;
    label: string;
  };
  usage?: {
    plan?: string;
    windows?: unknown[];
  };
};

export type GatewayModelAuthStatusResult = {
  ts: number;
  providers: GatewayModelAuthStatusProvider[];
};

export type GatewayConfigPatchResult = {
  ok?: boolean;
  noop?: boolean;
  path?: string;
  config?: unknown;
};

export type GatewayConfigGetResult = {
  hash?: string;
  config?: unknown;
  path?: string;
  exists?: boolean;
};

export type GatewayAgentsListResult = {
  defaultId?: string;
  mainKey?: string;
  scope?: "per-sender" | "global";
  agents?: Array<{
    id: string;
    name?: string;
    workspace?: string;
    model?: {
      primary?: string;
      fallbacks?: string[];
    };
    identity?: {
      name?: string;
      theme?: string;
      emoji?: string;
      avatar?: string;
      avatarUrl?: string;
    };
  }>;
};

export type GatewayAgentsCreateResult = {
  ok: true;
  agentId: string;
  name: string;
  workspace: string;
};

export type GatewayAgentsUpdateResult = {
  ok: true;
  agentId: string;
};

export type GatewayAgentFileEntry = {
  name: string;
  path: string;
  missing: boolean;
  size?: number;
  updatedAtMs?: number;
  content?: string;
};

export type GatewayAgentsFilesListResult = {
  agentId: string;
  workspace: string;
  files: GatewayAgentFileEntry[];
};

export type GatewayAgentsFilesGetResult = {
  agentId: string;
  workspace: string;
  file: GatewayAgentFileEntry;
};

export type GatewayAgentsFilesSetResult = {
  ok: true;
  agentId: string;
  workspace: string;
  file: GatewayAgentFileEntry;
};

export type GatewaySkillsStatusResult = {
  workspaceDir?: string;
  managedSkillsDir?: string;
  skills?: Array<{
    name: string;
    description?: string;
    skillKey?: string;
    emoji?: string;
    homepage?: string;
    disabled?: boolean;
    eligible?: boolean;
    missing?: Record<string, unknown> | string[] | null;
  }>;
};

export type GatewaySkillsUpdateResult = {
  ok?: boolean;
};

export type GatewayChannelsStatusResult = {
  ts?: number;
  channelOrder?: string[];
  channelLabels?: Record<string, string>;
  channelDetailLabels?: Record<string, string>;
  channelSystemImages?: Record<string, string>;
  channelMeta?: Array<{ id: string; label: string; detailLabel: string; systemImage?: string }>;
  channels?: Record<string, unknown>;
  channelAccounts?: Record<string, Array<{
    accountId: string;
    name?: string;
    enabled?: boolean;
    configured?: boolean;
    linked?: boolean;
    running?: boolean;
    connected?: boolean;
    lastError?: string;
    healthState?: string;
  }>>;
  channelDefaultAccountId?: Record<string, string>;
};

export type GatewayWebLoginResult = {
  connected?: boolean;
  qrDataUrl?: string;
  message?: string;
  accountId?: string;
};

export type GatewaySessionsUsageResult = {
  updatedAt?: number;
  startDate?: string;
  endDate?: string;
  sessions?: Array<{
    key: string;
    label?: string;
    updatedAt?: number;
    agentId?: string;
    channel?: string;
    modelProvider?: string;
    model?: string;
    usage?: GatewayUsageTotals | null;
  }>;
  totals?: GatewayUsageTotals;
  aggregates?: {
    byModel?: Array<{ model?: string; provider?: string; totals?: GatewayUsageTotals }>;
    byProvider?: Array<{ provider?: string; model?: string; totals?: GatewayUsageTotals }>;
    byAgent?: Array<{ agentId: string; totals?: GatewayUsageTotals }>;
    byChannel?: Array<{ channel: string; totals?: GatewayUsageTotals }>;
    daily?: Array<{ date: string; tokens: number; cost: number; messages: number; toolCalls: number; errors: number }>;
  };
};

export type GatewayUsageTotals = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
  totalTokens?: number;
  cached?: number;
  cost?: number;
  totalCost?: number;
  estimatedCostUsd?: number;
  inputCost?: number;
  outputCost?: number;
  cacheReadCost?: number;
  cacheWriteCost?: number;
  missingCostEntries?: number;
  messages?: number;
  toolCalls?: number;
  errors?: number;
};

export type GatewaySessionsListParams = {
  limit?: number;
  activeMinutes?: number;
  includeGlobal?: boolean;
  includeUnknown?: boolean;
  includeDerivedTitles?: boolean;
  includeLastMessage?: boolean;
  label?: string;
  spawnedBy?: string;
  agentId?: string;
  search?: string;
};

export type GatewaySessionRow = {
  key: string;
  kind?: "direct" | "group" | "global" | "unknown";
  label?: string;
  displayName?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  channel?: string;
  subject?: string;
  updatedAt?: number | null;
  sessionId?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  totalTokensFresh?: boolean;
  estimatedCostUsd?: number;
  status?: "running" | "done" | "failed" | "killed" | "timeout";
  parentSessionKey?: string;
  childSessions?: string[];
  modelProvider?: string;
  model?: string;
  thinkingDefault?: string;
  thinkingLevels?: Array<{ id: string; label?: string }>;
  contextTokens?: number;
  lastChannel?: string;
  lastTo?: string;
  lastAccountId?: string;
  lastThreadId?: string | number;
};

export type GatewaySessionsListResult = {
  path?: string | null;
  storePath?: string;
  stores?: Array<{ agentId: string; path: string }>;
  allAgents?: boolean;
  count?: number;
  activeMinutes?: number | null;
  defaults?: {
    modelProvider?: string | null;
    model?: string | null;
    contextTokens?: number | null;
    thinkingOptions?: string[];
    thinkingDefault?: string;
  };
  sessions?: GatewaySessionRow[];
  agents?: Array<{ id: string; name?: string; workspace?: string; model?: string }>;
};

export type GatewaySessionsPreviewResult = {
  ts: number;
  previews: Array<{
    key: string;
    status: "ok" | "empty" | "missing" | "error";
    items: Array<{ role: "user" | "assistant" | "tool" | "system" | "other"; text: string }>;
  }>;
};

export type GatewayHistoryResult = {
  messages: GatewayMessage[];
};

export type GatewayPart =
  | { type: "text"; text: string }
  | { type: "toolcall" | "toolCall"; name?: string; arguments?: unknown }
  | { type: "toolresult" | "toolResult"; name?: string; text?: string }
  | { type: "image" | "input_image" | "image_url"; data?: string; url?: string; mimeType?: string; mime_type?: string; text?: string; alt?: string; image_url?: { url?: string } };

export type GatewayUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
};

export type GatewayMessage = {
  role?: string;
  content?: GatewayPart[] | string;
  text?: string;
  timestamp?: number;
  model?: string;
  provider?: string;
  api?: string;
  usage?: GatewayUsage;
  senderLabel?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  errorMessage?: string;
};

export type GatewayChatEvent = {
  type?: string;
  state?: "delta" | "final" | "aborted" | "error";
  stream?: "tool" | "lifecycle" | "compaction" | "fallback" | string;
  sessionKey?: string;
  runId?: string;
  message?: GatewayMessage;
  data?: Record<string, unknown>;
  errorMessage?: string;
};
