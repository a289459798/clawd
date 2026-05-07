import type { MessagePart, PreviewMessage } from "../types/conversation";

export type ToolTimelineItem = {
  id: string;
  tool: string;
  status: "running" | "completed" | "failed";
  args?: string;
  result?: string;
  argSummary?: string;
  outputSummary?: string;
};

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

const compactWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const truncateSummary = (value?: string, maxLength = 90) => {
  if (!value) return undefined;
  const text = compactWhitespace(value);
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
};

export const summarizeToolPayload = (value?: string) => {
  if (!value) return undefined;
  const text = value.trim();
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed as Record<string, unknown>);
      const importantKeys = ["path", "file", "cmd", "command", "query", "q", "url", "name", "id"];
      const picked = importantKeys
        .map((key) => entries.find(([entryKey]) => entryKey === key))
        .filter((entry): entry is [string, unknown] => Boolean(entry));
      const source = picked.length > 0 ? picked : entries.slice(0, 3);
      const summary = source
        .map(([key, item]) => `${key}: ${typeof item === "string" ? item : JSON.stringify(item)}`)
        .join(" · ");
      return truncateSummary(summary);
    }
    if (Array.isArray(parsed)) {
      return truncateSummary(`${parsed.length} 项`);
    }
  } catch {
    // Plain text tool payloads are common during streaming.
  }
  return truncateSummary(text);
};

const isToolFailureText = (value?: string) => {
  if (!value) return false;
  const text = value.trim();
  if (!text) return false;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (record.ok === false || record.success === false) return true;
      if (typeof record.error === "string" && record.error.trim()) return true;
      if (typeof record.errorMessage === "string" && record.errorMessage.trim()) return true;
    }
  } catch {
    // Fall back to text heuristics below.
  }
  return /(^|\b)(error|failed|exception|not allowed|permission denied|enoent)(\b|:)/i.test(text);
};

export const buildToolTimelineItems = (parts: MessagePart[] = []): ToolTimelineItem[] => {
  const items: ToolTimelineItem[] = [];
  for (const part of parts) {
    if (part.kind === "tool_call") {
      items.push({
        id: `${items.length}-${part.tool}`,
        tool: part.tool || "tool",
        status: "running",
        args: part.args,
        argSummary: summarizeToolPayload(part.args),
      });
      continue;
    }

    if (part.kind === "tool_result") {
      const tool = part.tool || "tool";
      const pendingIndex = [...items]
        .reverse()
        .findIndex((item) => item.tool === tool && item.status === "running" && !item.result);
      const targetIndex = pendingIndex >= 0 ? items.length - 1 - pendingIndex : -1;
      const status: ToolTimelineItem["status"] = isToolFailureText(part.text) ? "failed" : "completed";
      if (targetIndex >= 0) {
        items[targetIndex] = {
          ...items[targetIndex],
          status,
          result: part.text,
          outputSummary: summarizeToolPayload(part.text),
        };
      } else {
        items.push({
          id: `${items.length}-${tool}-result`,
          tool,
          status,
          result: part.text,
          outputSummary: summarizeToolPayload(part.text),
        });
      }
    }
  }
  return items;
};

export const messageOrderKey = (message: PreviewMessage) => {
  const role = message.role?.toLowerCase() ?? "";
  const timestamp = message.timestamp ?? "";
  const text = (message.text ?? "").replace(/^__streaming__(?:[^_]+__)?/, "");
  const parts = JSON.stringify(message.parts ?? []);
  return `${role}|${timestamp}|${text}|${parts}`;
};

const normalizeMessageText = (value?: string) => (value ?? "").replace(/^__streaming__(?:[^_]+__)?/, "").trim();

const normalizePartForContentKey = (part: MessagePart) => {
  if (part.kind === "text") return { kind: part.kind, text: normalizeMessageText(part.text) };
  if (part.kind === "tool_call") return { kind: part.kind, tool: part.tool, args: part.args ?? "" };
  if (part.kind === "tool_result") return { kind: part.kind, tool: part.tool ?? "", text: part.text ?? "" };
  if (part.kind === "image") return { kind: part.kind, data: part.data, mime_type: part.mime_type ?? "", alt: part.alt ?? "" };
  return { kind: part.kind, name: part.name, path: part.path ?? "", mime_type: part.mime_type ?? "", size: part.size ?? 0 };
};

export const messageContentKey = (message: PreviewMessage) => {
  const role = message.role?.toLowerCase() ?? "";
  const text = normalizeMessageText(message.text);
  const parts = (message.parts ?? [])
    .map(normalizePartForContentKey)
    .filter((part) => part.kind !== "text" || ("text" in part && part.text));
  return `${role}|${text}|${JSON.stringify(parts)}`;
};

const timestampsCompatibleForReplacement = (left?: number, right?: number) => {
  if (typeof left !== "number" || typeof right !== "number") return true;
  return Math.abs(left - right) <= 2 * 60 * 1000;
};

const shouldReplaceWithSnapshotMessage = (current: PreviewMessage, snapshot: PreviewMessage) => {
  if (messageContentKey(current) !== messageContentKey(snapshot)) return false;
  if (!timestampsCompatibleForReplacement(current.timestamp, snapshot.timestamp)) return false;
  return true;
};

export const mergeSnapshotMessagesPreservingCurrentOrder = (currentMessages: PreviewMessage[] = [], snapshotMessages: PreviewMessage[] = []) => {
  if (currentMessages.length === 0) return snapshotMessages;
  if (snapshotMessages.length === 0) return currentMessages;

  const seen = new Set(currentMessages.map(messageOrderKey));
  const next = currentMessages.map((message, index) => ({ message, index }));
  for (const message of snapshotMessages) {
    const key = messageOrderKey(message);
    if (seen.has(key)) continue;
    const replaceIndex = next.findIndex((item) => shouldReplaceWithSnapshotMessage(item.message, message));
    if (replaceIndex >= 0) {
      seen.delete(messageOrderKey(next[replaceIndex].message));
      next[replaceIndex] = { ...next[replaceIndex], message };
      seen.add(key);
      continue;
    }
    seen.add(key);
    next.push({ message, index: next.length });
  }
  return next
    .sort((left, right) => {
      const leftTime = left.message.timestamp ?? Number.MAX_SAFE_INTEGER;
      const rightTime = right.message.timestamp ?? Number.MAX_SAFE_INTEGER;
      if (leftTime !== rightTime) return leftTime - rightTime;
      return left.index - right.index;
    })
    .map((item) => item.message);
};
