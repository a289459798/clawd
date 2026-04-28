import type { MessagePart, PreviewMessage } from "../types/conversation";

export const stringifyToolValue = (value: unknown) => {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const mapGatewayToolStreamToPart = (data?: Record<string, unknown>): Extract<MessagePart, { kind: "tool_call" | "tool_result" }> | null => {
  if (!data) return null;
  const name = typeof data.name === "string" && data.name.trim() ? data.name : "tool";
  const phase = typeof data.phase === "string" ? data.phase : "";
  if (phase === "result") {
    const text = stringifyToolValue(data.result ?? data.partialResult);
    return { kind: "tool_result", tool: name, text };
  }
  return { kind: "tool_call", tool: name, args: stringifyToolValue(data.args) };
};

export const hasToolParts = (parts: MessagePart[] = []) => parts.some((part) => part.kind === "tool_call" || part.kind === "tool_result");

export const messageOrderKey = (message: PreviewMessage) => {
  const role = message.role?.toLowerCase() ?? "";
  const timestamp = message.timestamp ?? "";
  const text = (message.text ?? "").replace(/^__streaming__(?:[^_]+__)?/, "");
  const parts = JSON.stringify(message.parts ?? []);
  return `${role}|${timestamp}|${text}|${parts}`;
};

export const mergeSnapshotMessagesPreservingCurrentOrder = (currentMessages: PreviewMessage[] = [], snapshotMessages: PreviewMessage[] = []) => {
  if (currentMessages.length === 0) return snapshotMessages;
  if (snapshotMessages.length === 0) return currentMessages;

  const seen = new Set(currentMessages.map(messageOrderKey));
  const next = [...currentMessages];
  for (const message of snapshotMessages) {
    const key = messageOrderKey(message);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(message);
  }
  return next;
};
