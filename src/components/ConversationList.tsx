import type { Conversation, ConversationStatus } from "../types/conversation";
import { ConversationCard } from "./ConversationCard";

type ConversationListItem = Conversation & {
  agentId: string;
  agentName: string;
};

type ConversationListProps = {
  t: (key: string) => string;
  conversations: ConversationListItem[];
  statusLabel: Record<ConversationStatus, string>;
  onOpen: (conversationId: string) => void;
  onHide: (agentId: string, conversationId: string) => void;
};

export function ConversationList({ conversations, statusLabel, onOpen, onHide, t }: ConversationListProps) {
  return (
    <div className="conversation-grid chat-layout-single">
      {conversations.map((conversation) => (
        <ConversationCard
          key={conversation.id}
          conversation={conversation}
          statusLabel={statusLabel}
          onOpen={onOpen}
          onHide={onHide}
          t={t}
        />
      ))}
    </div>
  );
}
