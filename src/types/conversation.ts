export type ConversationStatus = "working" | "completed" | "failed" | "stopped" | "idle";

export type MessagePart =
  | { kind: "text"; text: string }
  | { kind: "tool_call"; tool: string; args?: string }
  | { kind: "tool_result"; tool?: string; text?: string }
  | { kind: "image"; mime_type?: string; data: string; alt?: string }
  | { kind: "file"; mime_type?: string; name: string; size?: number; path?: string };

export type PreviewMessage = {
  role?: string;
  text: string;
  /** UI-only: merged consecutive duplicate text bubbles count */
  displayRepeatCount?: number;
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
  lastRunStartedAt?: number;
  lastEventAt?: number;
  lastTerminalAt?: number;
  lastTerminalReason?: "completed" | "aborted" | "error" | "failed" | "timeout" | "killed" | "cancelled" | "interrupted";
};

export type ConversationAgentRuntime = {
  id: string;
  label?: string;
  source?: string;
};

/** From Gateway `sessions.preview` — surfaces orphaned/missing transcript paths without scanning disk locally. */
export type TranscriptPreviewStatus = "ok" | "empty" | "missing" | "error";

export type SessionCompactionCheckpointSummary = {
  checkpointId: string;
  createdAt: number;
  reason: string;
};

export type Conversation = {
  id: string;
  /** Alias keys emitted by Gateway events distinct from canonical `id` (snapshot `key`). */
  alternateSessionKeys?: string[];
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
  thinkingDefault?: string;
  thinkingOptions?: Array<{ value: string; label: string }>;
  workspace: string;
  visible: boolean;
  pinned?: boolean;
  lastRole?: string;
  latestEventRole?: string;
  latestEventType?: string;
  previewMessages?: PreviewMessage[];
  runtime?: ConversationRuntime;
  agentRuntime?: ConversationAgentRuntime;
  isDraft?: boolean;  // 本地草稿状态，未创建真实 session
  draftAgentId?: string;  // 草稿对应的 agentId
  transcriptPreviewStatus?: TranscriptPreviewStatus;
  compactionCheckpointCount?: number;
  latestCompactionCheckpoint?: SessionCompactionCheckpointSummary;
};
