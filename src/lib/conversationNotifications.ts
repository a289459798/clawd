import type { Conversation } from "../types/conversation";
import type { NotificationSettings } from "../types/settings";
import { isConversationRunning } from "./conversationRunState";

type CompletionNotificationParams = {
  previous: Conversation | null;
  current: Conversation;
  settings: NotificationSettings;
  windowFocused: boolean;
  seenKeys: Set<string>;
  copy?: Partial<{
    genericFinished: string;
    completed: string;
    failed: string;
  }>;
};

export type ConversationCompletionNotification = {
  key: string;
  title: string;
  body: string;
};

const FAILURE_REASONS = new Set(["error", "failed", "timeout"]);
const STOP_REASONS = new Set(["aborted", "killed", "cancelled", "interrupted"]);

function isTerminalConversation(conversation: Conversation) {
  return conversation.status === "completed" || conversation.status === "failed" || conversation.status === "stopped";
}

function wasRunning(conversation: Conversation | null) {
  return isConversationRunning(conversation);
}

function classifyTerminal(conversation: Conversation): "success" | "failure" | "stopped" | null {
  const reason = conversation.runtime?.lastTerminalReason;
  if (conversation.status === "completed" || reason === "completed") return "success";
  if (conversation.status === "failed" || (reason && FAILURE_REASONS.has(reason))) return "failure";
  if (conversation.status === "stopped" || (reason && STOP_REASONS.has(reason))) return "stopped";
  return null;
}

function latestAssistantSummary(conversation: Conversation) {
  const assistantText = [...(conversation.previewMessages ?? [])]
    .reverse()
    .find((message) => message.role === "assistant" && message.text.trim())
    ?.text.trim();
  const text = assistantText || conversation.lastMessage.trim();
  return text.replace(/\s+/g, " ").slice(0, 160);
}

export function buildConversationCompletionNotification({
  previous,
  current,
  settings,
  windowFocused,
  seenKeys,
  copy,
}: CompletionNotificationParams): ConversationCompletionNotification | null {
  if (!settings.conversationFinished) return null;
  if (settings.onlyWhenUnfocused && windowFocused) return null;
  if (!previous || !wasRunning(previous) || !isTerminalConversation(current)) return null;

  const terminalKind = classifyTerminal(current);
  if (terminalKind === "stopped" || terminalKind === null) return null;
  if (terminalKind === "success" && !settings.notifyOnSuccess) return null;
  if (terminalKind === "failure" && !settings.notifyOnFailure) return null;

  const terminalAt = current.runtime?.lastTerminalAt ?? current.updatedAt ?? Date.now();
  const runId = previous.runtime?.activeRunId ?? current.runtime?.lastRunStartedAt ?? previous.runtime?.activeStartedAt ?? "unknown-run";
  const key = `${current.id}:${runId}:${terminalAt}`;
  if (seenKeys.has(key)) return null;

  seenKeys.add(key);
  const body = settings.privacyMode
    ? copy?.genericFinished ?? "对话已结束"
    : terminalKind === "success"
      ? latestAssistantSummary(current) || (copy?.completed ?? "对话已完成")
      : current.lastMessage.trim() || (copy?.failed ?? "对话失败，请回到 ClawKit 查看详情");

  return {
    key,
    title: current.title || "ClawKit",
    body,
  };
}
