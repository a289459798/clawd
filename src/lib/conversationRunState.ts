import type { Conversation } from "../types/conversation";

type ConversationLike = Pick<Conversation, "status"> | null | undefined;

/**
 * Unified run-state gate used by UI and list reconciliation.
 * Keep this as the only place to adjust "running" semantics.
 */
export function isConversationRunning(conversation: ConversationLike) {
  return conversation?.status === "working";
}

