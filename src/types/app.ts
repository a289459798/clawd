import type { Conversation, ConversationRuntime, MessagePart, PreviewMessage } from "./conversation";
import type { GatewayModelsResult, OpenClawSnapshot } from "./gateway";

export type NavKey = "conversations" | "models" | "skills" | "connections" | "usage" | "cron" | "pets";
export type AgentStatus = "working" | "completed" | "idle";

export type Agent = {
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

export type PluginRepairAction = {
  label: string;
  /** Copy-friendly CLI snippet; executed by user in system terminal. */
  cli?: string;
  docUrl?: string;
};

export type PluginRepairCard = {
  pluginId: string;
  headlineZh: string;
  bodyZh: string;
  /** Short technical excerpt for advanced users */
  rawDetail?: string;
  failurePhase?: string;
  origin?: string;
  actions: PluginRepairAction[];
};

export type SkillPolicyHint = {
  severity: "warning" | "info";
  title: string;
  body: string;
  actions?: PluginRepairAction[];
};

export type Skill = {
  id: string;
  name: string;
  summary: string;
  description?: string;
  enabled: boolean;
  eligible?: boolean;
  missing?: string[];
  homepage?: string;
  /** Gateway skill policy / dependency hints (distinct from plugin runtime load errors). */
  policyHints?: SkillPolicyHint[];
};

export type ChannelConnection = {
  id: string;
  name: string;
  status: "connected" | "degraded" | "warning" | "disabled";
  detail: string;
  config: string;
  activity: string;
  /** Gateway-reported operational hint (running but unhealthy transport/task state). */
  healthHint?: string;
  docsUrl?: string;
  packageName?: string;
  accounts?: Array<{
    accountId: string;
    name?: string;
    enabled?: boolean;
    configured?: boolean;
    linked?: boolean;
    connected?: boolean;
    running?: boolean;
    lastError?: string;
    healthState?: string;
    tokenSource?: string;
    botTokenSource?: string;
    appTokenSource?: string;
    signingSecretSource?: string;
    tokenStatus?: "available" | "configured_unavailable" | "missing";
    botTokenStatus?: "available" | "configured_unavailable" | "missing";
    appTokenStatus?: "available" | "configured_unavailable" | "missing";
    signingSecretStatus?: "available" | "configured_unavailable" | "missing";
    userTokenStatus?: "available" | "configured_unavailable" | "missing";
    statusState?: string;
  }>;
  /** Matched from Gateway health.plugins.errors for this channel id. */
  pluginRepairs?: PluginRepairCard[];
};

export type UsageTotals = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
  cost?: number;
  messages?: number;
  toolCalls?: number;
  errors?: number;
};

export type ClawxBootstrapStatus = {
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

export type WeixinPluginStatus = {
  installed: boolean;
  enabled: boolean;
  installedVersion?: string | null;
  latestVersion?: string | null;
  updateAvailable: boolean;
  latestCheckError?: string | null;
};

export type OpenClawCliStatus = {
  installed: boolean;
  path?: string | null;
  installedVersion?: string | null;
  latestVersion?: string | null;
  updateAvailable: boolean;
  latestCheckError?: string | null;
};

export type ComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  previewUrl?: string;
  size?: number;
  path?: string;
};

export type QueuedComposerMessage = {
  id: string;
  text: string;
  attachments: ComposerAttachment[];
  createdAt: number;
  model?: string;
  thinking?: string;
};

export type GatewayCreateSessionResult = {
  key?: string;
  sessionId?: string;
  ok?: boolean;
};

export type ModelOption = {
  value: string;
  label: string;
};

export type BuildAgentsOptions = {
  preserveExistingConversations?: boolean;
  activeConversationId?: string | null;
  priorityAgentId?: string | null;
};

export type AppMessageHelpers = {
  MessagePart: MessagePart;
  PreviewMessage: PreviewMessage;
  ConversationRuntime: ConversationRuntime;
  GatewayModelsResult: GatewayModelsResult;
  OpenClawSnapshot: OpenClawSnapshot;
};
