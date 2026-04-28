import { Icon, IconNames } from "./Icon";
import type { Conversation, ConversationStatus } from "../types/conversation";

// 从 title 解析对话类型
function getLabelTypeFromTitle(title?: string): { text: string; color: string } {
  const lower = title?.toLowerCase() || "";
  if (lower.includes("dashboard")) return { text: "clawx", color: "#52f2c5" };
  if (lower.includes("main")) return { text: "主对话", color: "#52f2c5" };
  if (lower.includes("cron")) return { text: "定时任务", color: "#f3bf63" };
  if (lower.includes("dreaming")) return { text: "做梦", color: "#c08bff" };
  if (lower.includes("channel")) return { text: "频道", color: "#7aa2ff" };
  return { text: "对话", color: "#7aa2ff" };
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
  const labelType = getLabelTypeFromTitle(conversation.title);

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
            <Icon name={IconNames.MAXIMIZE} size={14} color="#ffffff" style={{ fill: '#ffffff', stroke: '#ffffff' }} />
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
            <Icon name={IconNames.CLOSE} size={18} color="#ffffff" style={{ fill: '#ffffff', stroke: '#ffffff' }} />
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
