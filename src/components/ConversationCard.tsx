import { Icon, IconNames } from "./Icon";
import type { Conversation, ConversationStatus } from "../types/conversation";

export function getLabelTypeFromKey(key?: string): { text: string; color: string } {
  const lower = key?.toLowerCase() || "";
  if (lower.includes(":dashboard:")) return { text: "ClawKit", color: "var(--green)" };
  if (lower.includes(":main:")) return { text: "主对话", color: "var(--green)" };
  if (lower.includes(":cron:")) return { text: "定时任务", color: "var(--yellow)" };
  if (lower.includes(":dreaming-")) return { text: "做梦", color: "#c08bff" };
  if (lower.includes(":channel:")) return { text: "频道", color: "var(--blue)" };
  return { text: "对话", color: "var(--blue)" };
}

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
  const labelType = getLabelTypeFromKey(conversation.id);

  return (
    <article className={`conversation-card compact ${conversation.status}`}>
      <div className="conversation-card-head">
        <div className="conversation-card-title-block">
          <div className="card-row">
            <strong className="conversation-card-title">{conversation.title}</strong>
          </div>
          <div className="conversation-card-subline">
            <span>{conversation.agentName} · {conversation.model} · {conversation.tokens}</span>
            {conversation.agentRuntime ? (
              <span className="runtime-badge" title={`Agent Runtime: ${conversation.agentRuntime.id}`}>
                {conversation.agentRuntime.label ?? conversation.agentRuntime.id}
              </span>
            ) : null}
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
            <svg className="conversation-maximize-icon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M5.2 2.5H2.5v2.7" />
              <path d="M8.8 2.5h2.7v2.7" />
              <path d="M5.2 11.5H2.5V8.8" />
              <path d="M8.8 11.5h2.7V8.8" />
            </svg>
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
            <Icon name={IconNames.CLOSE} size={18} />
          </button>
        </div>
      </div>

      <button className="conversation-card-body-button" onClick={() => onOpen(conversation.id)} type="button">
        <div className="conversation-summary">
          <p>{conversation.lastMessage}</p>
          <div className="summary-meta compact-time-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: labelType.color, fontSize: "12px" }}>
              {labelType.text}
            </span>
            <span>{conversation.lastTime}</span>
          </div>
        </div>
      </button>
    </article>
  );
}
