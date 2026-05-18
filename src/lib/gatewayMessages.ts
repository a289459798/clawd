import type { MessagePart } from "../types/conversation";
import type { GatewayMessage } from "../types/gateway";

type GatewayDeltaCarrier = {
  deltaText?: unknown;
  replace?: unknown;
  data?: unknown;
  message?: unknown;
};

export function extractUsageFromGatewayMessage(message?: GatewayMessage | null) {
  return {
    input_tokens: message?.usage?.input,
    output_tokens: message?.usage?.output,
    cache_read_tokens: message?.usage?.cacheRead,
    cache_write_tokens: message?.usage?.cacheWrite,
  };
}

export function stripInboundWrapperText(text: string) {
  const metadataHeading = "(?:Conversation info|Sender|Chat history since last reply|Thread starter|Location)\\s+\\([^)]*(?:untrusted|for context)[^)]*\\):";
  return text
    .replace(new RegExp(`${metadataHeading}\\s*\`\`\`json[\\s\\S]*?\`\`\`\\s*`, "gi"), "")
    .replace(new RegExp(`${metadataHeading}\\s*\\n\\s*\`\`\`json\\n[\\s\\S]*?\\n\\s*\`\`\`\\n?`, "gi"), "")
    .replace(new RegExp(`${metadataHeading}\\s*\\n\\s*\\{[\\s\\S]*?\\n\\s*\\}\\n?`, "gi"), "")
    .replace(/Sender\s+\(untrusted\s+metadata\):\s*[^\n]*\n?/gi, "")
    .replace(/^\[[A-Za-z]+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s*GMT[+-]\d+\]\s*/gm, "")
    .trim();
}

const MEDIA_ATTACHED_PATTERN = /\[media attached:\s+(.+?)\s+\(([^()\n]+)\)\]/g;

function basenameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

export function extractGatewayDeltaFrame(frame?: GatewayDeltaCarrier | null) {
  const data = recordValue(frame?.data);
  const message = recordValue(frame?.message);
  return {
    deltaText: stringValue(frame?.deltaText) ?? stringValue(data?.deltaText) ?? stringValue(message?.deltaText),
    replace: booleanValue(frame?.replace) ?? booleanValue(data?.replace) ?? booleanValue(message?.replace) ?? false,
  };
}

function splitTextMediaAttachmentParts(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  MEDIA_ATTACHED_PATTERN.lastIndex = 0;
  while ((match = MEDIA_ATTACHED_PATTERN.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    const cleanBefore = stripInboundWrapperText(before);
    if (cleanBefore && cleanBefore !== "fetch failed") {
      parts.push({ kind: "text", text: cleanBefore });
    }
    const path = match[1]?.trim();
    const mimeType = match[2]?.trim();
    if (path) {
      parts.push({
        kind: "file",
        name: basenameFromPath(path),
        path,
        mime_type: mimeType || undefined,
      });
    }
    lastIndex = match.index + match[0].length;
  }
  const after = text.slice(lastIndex);
  const cleanAfter = stripInboundWrapperText(after);
  if (cleanAfter && cleanAfter !== "fetch failed") {
    parts.push({ kind: "text", text: cleanAfter });
  }
  return parts;
}

function stripMediaAttachmentMarkers(text: string) {
  return text.replace(MEDIA_ATTACHED_PATTERN, "").trim();
}

function rawMessageText(message?: { text?: string; content?: unknown } | null) {
  if (!message) return "";
  if (typeof message.text === "string") return message.text;
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => typeof part?.text === "string" ? part.text : "")
      .join("\n");
  }
  return "";
}

export function isInternalOpenClawMessage(message?: { role?: string; text?: string; content?: unknown; senderLabel?: string } | null) {
  const rawText = rawMessageText(message).trim();
  const cleanedText = stripInboundWrapperText(rawText).trim();
  const role = message?.role?.toLowerCase();
  const sender = message?.senderLabel?.toLowerCase();
  const isAsyncCompletionEvent = rawText.includes("An async command completion event was triggered")
    || (rawText.includes("Exec completed") && rawText.includes("user delivery is disabled"));

  if (rawText.includes("Sender (untrusted metadata)") && cleanedText.length === 0) return true;
  if (rawText.includes("Conversation info (untrusted metadata)") && cleanedText.length === 0) return true;
  if (sender === "gateway-client" && rawText.includes("Sender (untrusted metadata)")) return true;
  // Only trust the gateway-client label for known internal completion/heartbeat payloads.
  // This avoids hiding a legitimate user/assistant message just because text mentions gateway-client.
  if (sender === "gateway-client" && (isAsyncCompletionEvent || cleanedText === "HEARTBEAT_OK")) return true;
  if (cleanedText === "HEARTBEAT_OK") return true;
  if (isAsyncCompletionEvent) return true;
  if (role === "assistant" && cleanedText === "HEARTBEAT_OK") return true;
  return false;
}

export function extractTextFromGatewayMessage(message?: GatewayMessage | null) {
  const messageError = (message as { errorMessage?: string } | null | undefined)?.errorMessage;
  if (!message || messageError) return "";
  if (typeof message.text === "string") {
    const cleaned = stripMediaAttachmentMarkers(stripInboundWrapperText(message.text));
    return cleaned === "fetch failed" ? "" : cleaned;
  }
  if (typeof message.content === "string") {
    const cleaned = stripMediaAttachmentMarkers(stripInboundWrapperText(message.content));
    return cleaned === "fetch failed" ? "" : cleaned;
  }
  if (Array.isArray(message.content)) {
    if (message.content.length === 0) return "";
    const cleaned = stripMediaAttachmentMarkers(stripInboundWrapperText(message.content
      .map((part) => {
        if (part.type === "text") return part.text ?? "";
        return "";
      })
      .join("\n")
      .trim()));
    return cleaned === "fetch failed" ? "" : cleaned;
  }
  return "";
}

export function mapGatewayContentToParts(message?: GatewayMessage | null): MessagePart[] {
  const messageError = (message as { errorMessage?: string } | null | undefined)?.errorMessage;
  if (!message || messageError) return [];

  if ((message.role?.toLowerCase() === "toolresult" || message.role?.toLowerCase() === "tool_result") && Array.isArray(message.content)) {
    const text = message.content
      .map((part) => (part.type === "text" ? stripInboundWrapperText(part.text ?? "") : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    return text
      ? [{ kind: "tool_result", tool: message.toolName, text }]
      : [];
  }

  if (typeof message.content === "string") {
    return splitTextMediaAttachmentParts(message.content);
  }
  if (Array.isArray(message.content)) {
    if (message.content.length === 0) return [];
    const mappedParts = message.content.flatMap<MessagePart>((part) => {
      if (part.type === "text") {
        return part.text ? [{ kind: "text", text: part.text }] : [];
      }
      if (part.type === "toolcall" || part.type === "toolCall") {
        return [{ kind: "tool_call", tool: part.name ?? "tool", args: typeof part.arguments === "string" ? part.arguments : JSON.stringify(part.arguments ?? {}, null, 2) }];
      }
      if (part.type === "toolresult" || part.type === "toolResult") {
        const cleaned = stripInboundWrapperText(part.text ?? "");
        return cleaned ? [{ kind: "tool_result", tool: part.name, text: cleaned }] : [];
      }
      if (part.type === "image" || part.type === "input_image" || part.type === "image_url") {
        const src = part.data ?? part.url ?? part.image_url?.url;
        return src ? [{ kind: "image", data: src, mime_type: part.mimeType ?? part.mime_type, alt: part.text ?? part.alt }] : [];
      }
      if (part.type === "file" || part.type === "attachment" || part.type === "input_file") {
        const path = part.path ?? part.url;
        const name = part.fileName ?? part.filename ?? part.name ?? (path ? basenameFromPath(path) : "附件");
        return [{
          kind: "file",
          name,
          path,
          mime_type: part.mimeType ?? part.mime_type,
          size: safeNumber(part.size),
        }];
      }
      if (part.type === "presentation" || part.type === "button" || part.type === "buttons" || part.type === "control" || part.type === "interactive" || part.type === "card" || part.type === "rich") {
        return [{
          kind: "rich",
          type: part.type,
          title: part.title ?? part.label ?? part.name,
          text: part.text,
        }];
      }
      return [];
    });
    return mergeStreamingParts(mappedParts).flatMap<MessagePart>((part) => {
      if (part.kind !== "text") return [part];
      return splitTextMediaAttachmentParts(part.text);
    });
  }
  if (typeof message.text === "string") {
    return splitTextMediaAttachmentParts(message.text);
  }
  return [];
}

export function mergeStreamingParts(existingParts: MessagePart[] = [], incomingParts: MessagePart[] = [], deltaText = ""): MessagePart[] {
  const merged: MessagePart[] = [];
  let textBuffer = "";

  const flushText = () => {
    if (textBuffer) {
      merged.push({ kind: "text", text: textBuffer });
      textBuffer = "";
    }
  };

  for (const part of existingParts) {
    if (part.kind === "text") {
      textBuffer += part.text ?? "";
    } else {
      flushText();
      merged.push(part);
    }
  }

  let hasIncomingTextPart = false;
  for (const part of incomingParts) {
    if (part.kind === "text") {
      hasIncomingTextPart = true;
      textBuffer += part.text ?? "";
      continue;
    }
    flushText();
    const key = JSON.stringify(part);
    const exists = merged.some((item) => item.kind !== "text" && JSON.stringify(item) === key);
    if (!exists) {
      merged.push(part);
    }
  }

  if (!hasIncomingTextPart && deltaText) {
    textBuffer += deltaText;
  }

  flushText();
  return merged;
}
