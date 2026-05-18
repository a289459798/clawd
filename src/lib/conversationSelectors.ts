import type { Agent } from "../types/app";
import type { Conversation } from "../types/conversation";

export type VisibleConversationOptions = {
  showSystemConversations?: boolean;
};

export function conversationMatchesSessionKey(conversation: Conversation, sessionKey: string | null | undefined) {
  if (!sessionKey) return false;
  if (conversation.id === sessionKey) return true;
  return Boolean(conversation.alternateSessionKeys?.includes(sessionKey));
}

export function findConversationByGatewaySessionKey(agents: Agent[], sessionKey: string | null | undefined) {
  if (!sessionKey) return null;
  for (const agent of agents) {
    for (const conversation of agent.conversations) {
      if (conversationMatchesSessionKey(conversation, sessionKey)) {
        return conversation;
      }
    }
  }
  return null;
}

export function isSystemAutoConversation(conversation: Conversation) {
  const ids = [conversation.id, ...(conversation.alternateSessionKeys ?? [])].map((value) => value.toLowerCase());
  if (ids.some((value) => /(^|:)cron(?=[:\-]|$)/u.test(value) || /(^|:)dream(?:ing)?(?=[:\-]|$)/u.test(value) || /(^|:)heartbeat(?=[:\-]|$)/u.test(value))) {
    return true;
  }
  const channel = conversation.channel?.trim().toLowerCase();
  if (channel === "cron" || channel === "dream" || channel === "dreaming" || channel === "heartbeat") {
    return true;
  }
  const title = conversation.title.trim().toLowerCase();
  return /^cron\b/u.test(title) || /^dream(?:ing)?\b/u.test(title) || /^heartbeat\b/u.test(title);
}

export const getVisibleConversations = (agents: Agent[], options: VisibleConversationOptions = {}) => {
  return agents
    .flatMap((agent) =>
      agent.conversations
        .filter((conversation) => conversation.visible && (options.showSystemConversations || !isSystemAutoConversation(conversation)))
        .map((conversation) => ({
          ...conversation,
          agentId: agent.id,
          agentName: agent.name,
          color: agent.color,
        })),
    )
    .sort((left, right) => {
      const statusRank = { working: 0, failed: 1, stopped: 2, completed: 3, idle: 4 };
      const byStatus = statusRank[left.status] - statusRank[right.status];
      if (byStatus !== 0) return byStatus;
      return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
    });
};

export const findConversationById = (agents: Agent[], conversationId: string | null) => {
  if (!conversationId) return null;
  return agents.flatMap((agent) => agent.conversations).find((conversation) => conversation.id === conversationId) ?? null;
};
