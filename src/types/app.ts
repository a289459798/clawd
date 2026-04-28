import type { Conversation, ConversationRuntime, MessagePart, PreviewMessage } from "./conversation";
import type { GatewayModelsResult, OpenClawSnapshot } from "./gateway";

export type NavKey = "conversations" | "skills" | "connections";
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
  location: string;
  enabled: boolean;
};

export type ChannelConnection = {
  id: string;
  name: string;
  status: "connected" | "warning" | "disabled";
  detail: string;
  config: string;
  activity: string;
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
};

export type AppMessageHelpers = {
  MessagePart: MessagePart;
  PreviewMessage: PreviewMessage;
  ConversationRuntime: ConversationRuntime;
  GatewayModelsResult: GatewayModelsResult;
  OpenClawSnapshot: OpenClawSnapshot;
};
