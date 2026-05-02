import type { Conversation, ConversationRuntime, MessagePart, PreviewMessage } from "./conversation";
import type { GatewayModelsResult, OpenClawSnapshot } from "./gateway";

export type NavKey = "conversations" | "models" | "skills" | "connections" | "usage";
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

export type Skill = {
  id: string;
  name: string;
  summary: string;
  description?: string;
  enabled: boolean;
  eligible?: boolean;
  missing?: string[];
  homepage?: string;
};

export type ChannelConnection = {
  id: string;
  name: string;
  status: "connected" | "warning" | "disabled";
  detail: string;
  config: string;
  activity: string;
  docsUrl?: string;
  packageName?: string;
  accounts?: Array<{
    accountId: string;
    name?: string;
    enabled?: boolean;
    configured?: boolean;
    connected?: boolean;
    running?: boolean;
    lastError?: string;
  }>;
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
};

export type QueuedComposerMessage = {
  id: string;
  text: string;
  attachments: ComposerAttachment[];
  createdAt: number;
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
