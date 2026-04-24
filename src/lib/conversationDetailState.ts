import type { PreviewMessage } from "../types/conversation";

const STREAMING_PREFIX = /^__streaming__(?:[^_]+__)?/;

export function getConversationDetailState(messages: PreviewMessage[], lastRole?: string, showFullHistory = false) {
  const lastUserIdx = [...messages].reverse().findIndex((m) => m.role?.toLowerCase() === "user");
  const userPos = lastUserIdx >= 0 ? messages.length - 1 - lastUserIdx : -1;
  const targetMessages = showFullHistory ? messages : userPos >= 0 ? messages.slice(userPos) : messages;
  const assistantSlice = showFullHistory ? messages : userPos >= 0 ? messages.slice(userPos + 1) : [];
  const hasRenderableContent = assistantSlice.some((m) => {
    const hasText = (m.text ?? "").replace(STREAMING_PREFIX, "").trim().length > 0;
    const hasRenderableParts = (m.parts ?? []).some((part) => part.kind === "text" || part.kind === "image");
    return hasText || hasRenderableParts;
  });
  const isWaitingReply = !hasRenderableContent && lastRole === "user";
  const isStillStreaming = targetMessages.some(
    (m) => m.role?.toLowerCase() === "assistant" && STREAMING_PREFIX.test(m.text),
  );
  const normalizedMessages = targetMessages.map((m) =>
    STREAMING_PREFIX.test(m.text) ? { ...m, text: m.text.replace(STREAMING_PREFIX, "") } : m,
  );

  return {
    hasRenderableContent,
    isWaitingReply,
    isStillStreaming,
    normalizedMessages,
  };
}
