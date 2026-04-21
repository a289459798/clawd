type MessagePart =
  | { kind: "text"; text: string }
  | { kind: "tool_call"; tool: string; args?: string }
  | { kind: "tool_result"; tool?: string; text?: string }
  | { kind: "image"; mime_type?: string; data: string; alt?: string };

export type RealtimeSessionPatch = {
  key: string;
  updatedAt?: number;
  lastMessage?: string;
  lastRole?: string;
  latestEventRole?: string;
  latestEventType?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  model?: string;
  previewMessages?: Array<{ role?: string; text: string; parts?: MessagePart[] }>;
};

export type RealtimeGatewayEvent = {
  type: "session_patch";
  session: RealtimeSessionPatch;
};
