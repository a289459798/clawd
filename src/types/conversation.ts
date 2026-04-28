export type ConversationStatus = "working" | "completed" | "idle";

export type MessagePart =
  | { kind: "text"; text: string }
  | { kind: "tool_call"; tool: string; args?: string }
  | { kind: "tool_result"; tool?: string; text?: string }
  | { kind: "image"; mime_type?: string; data: string; alt?: string };

export type PreviewMessage = {
  role?: string;
  text: string;
  parts?: MessagePart[];
  model?: string;
  provider?: string;
  api?: string;
  timestamp?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  senderLabel?: string;
};

export type ConversationRuntime = {
  activeRunId?: string | null;
  activeStartedAt?: number;
  lastEventAt?: number;
  lastTerminalAt?: number;
  lastTerminalReason?: "completed" | "aborted" | "error" | "failed" | "cancelled" | "interrupted";
};

export type Conversation = {
  id: string;
  title: string;
  channel?: string;
  status: ConversationStatus;
  lastMessage: string;
  lastTime: string;
  updatedAt?: number;
  tokens: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  model: string;
  workspace: string;
  visible: boolean;
  pinned?: boolean;
  lastRole?: string;
  latestEventRole?: string;
  latestEventType?: string;
  previewMessages?: PreviewMessage[];
  runtime?: ConversationRuntime;
  isDraft?: boolean;  // 本地草稿状态，未创建真实 session
  draftAgentId?: string;  // 草稿对应的 agentId
};
