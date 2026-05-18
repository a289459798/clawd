import type { PreviewMessage } from "../types/conversation";

const STREAMING_PREFIX = /^__streaming__(?:[^_]+__)?/;

export function getLatestUserMessage(messages: PreviewMessage[]) {
  return messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role?.toLowerCase() === "user")
    .sort((left, right) => {
      const leftTime = left.message.timestamp ?? left.index;
      const rightTime = right.message.timestamp ?? right.index;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return right.index - left.index;
    })[0]?.message ?? null;
}

export function getConversationDetailState(messages: PreviewMessage[], lastRole?: string, showFullHistory = false) {
  const orderedMessages = messages
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const leftTime = left.message.timestamp ?? left.index;
      const rightTime = right.message.timestamp ?? right.index;
      if (leftTime !== rightTime) return leftTime - rightTime;
      return left.index - right.index;
    })
    .map((item) => item.message);
  const latestUser = getLatestUserMessage(orderedMessages);
  const latestUserTimestamp = latestUser?.timestamp;
  const latestUserIndex = latestUser ? orderedMessages.lastIndexOf(latestUser) : -1;
  const targetMessages = showFullHistory
    ? orderedMessages
    : latestUser
      ? orderedMessages.filter((message, index) => {
          if (message === latestUser) return true;
          if (typeof latestUserTimestamp === "number" && typeof message.timestamp === "number") {
            return message.timestamp >= latestUserTimestamp;
          }
          return index > latestUserIndex;
        })
      : orderedMessages;
  const assistantSlice = showFullHistory
    ? orderedMessages
    : targetMessages.filter((message) => message.role?.toLowerCase() !== "user");
  const hasRenderableContent = assistantSlice.some((m) => {
    const hasText = (m.text ?? "").replace(STREAMING_PREFIX, "").trim().length > 0;
    const hasRenderableParts = (m.parts ?? []).some(
      (part) => part.kind === "text" || part.kind === "image" || part.kind === "file" || part.kind === "tool_call" || part.kind === "rich",
    );
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
