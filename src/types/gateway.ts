import type { MessagePart } from "./conversation";

export type SnapshotSession = {
  id: string;
  agent_id: string;
  key: string;
  title: string;
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

export type GatewayModelSummary = {
  id: string;
  provider?: string;
  name?: string;
  alias?: string;
  label?: string;
};

export type GatewayModelsResult = {
  models?: GatewayModelSummary[];
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
