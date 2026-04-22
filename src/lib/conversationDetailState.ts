import type { PreviewMessage } from "../types/conversation";

export function getConversationDetailState(messages: PreviewMessage[], lastRole?: string) {
  const lastUserIdx = [...messages].reverse().findIndex((m) => m.role?.toLowerCase() === "user");
  const userPos = lastUserIdx >= 0 ? messages.length - 1 - lastUserIdx : -1;
  const afterUser = userPos >= 0 ? messages.slice(userPos + 1) : [];
  const hasRenderableContent = afterUser.some(
    (m) => (m.text ?? "").replace(/^__streaming__/, "").trim().length > 0 || (m.parts?.length ?? 0) > 0,
  );
  const isWaitingReply = !hasRenderableContent && lastRole === "user";
  const isStillStreaming = afterUser.some(
    (m) => m.role?.toLowerCase() === "assistant" && m.text.startsWith("__streaming__"),
  );
  const normalizedMessages = afterUser.map((m) =>
    m.text.startsWith("__streaming__") ? { ...m, text: m.text.replace(/^__streaming__/, "") } : m,
  );

  return {
    afterUser,
    hasRenderableContent,
    isWaitingReply,
    isStillStreaming,
    normalizedMessages,
  };
}
