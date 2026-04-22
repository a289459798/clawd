import type { Conversation, ConversationStatus } from "../types/conversation";

type ConversationCardData = Conversation & {
  agentId: string;
  agentName: string;
};

type ConversationCardProps = {
  conversation: ConversationCardData;
  statusLabel: Record<ConversationStatus, string>;
  onOpen: (conversationId: string) => void;
  onHide: (agentId: string, conversationId: string) => void;
};

export function ConversationCard({ conversation, statusLabel, onOpen, onHide }: ConversationCardProps) {
  return (
    <article className={`conversation-card compact ${conversation.status}`}>
      <div className="conversation-card-head">
        <div className="conversation-card-title-block">
          <div className="card-row">
            <strong className="conversation-card-title">{conversation.title}</strong>
          </div>
          <div className="conversation-card-subline">
            <span>{conversation.agentName} · {conversation.model} · {conversation.tokens}</span>
            <span className={`status-badge ${conversation.status}`}>{statusLabel[conversation.status]}</span>
          </div>
        </div>
        <div className="card-actions">
          <button
            className="icon-only-button subtle conversation-open-button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(conversation.id);
            }}
            title="打开当前对话"
            type="button"
          >
            ⤢
          </button>
          <button
            className="icon-only-button subtle"
            onClick={(event) => {
              event.stopPropagation();
              onHide(conversation.agentId, conversation.id);
            }}
            title="隐藏"
            type="button"
          >
            ✕
          </button>
        </div>
      </div>

      <button className="conversation-card-body-button" onClick={() => onOpen(conversation.id)} type="button">
        <div className="conversation-summary">
          <p>{conversation.lastMessage}</p>
          <div className="summary-meta compact-time-row">
            <span>{conversation.lastTime}</span>
          </div>
        </div>
      </button>
    </article>
  );
}
