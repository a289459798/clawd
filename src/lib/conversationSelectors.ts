import type { Agent } from "../types/app";

export const getVisibleConversations = (agents: Agent[]) => {
  return agents
    .flatMap((agent) =>
      agent.conversations
        .filter((conversation) => conversation.visible)
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
