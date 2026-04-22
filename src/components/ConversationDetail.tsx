import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Conversation, ConversationStatus, MessagePart } from "../types/conversation";

type ConversationDetailProps = {
  activeConversation: Conversation;
  agentName: string;
  statusLabel: Record<ConversationStatus, string>;
  userExpanded: boolean;
  onUserExpandedChange: (expanded: boolean) => void;
  onBack: () => void;
  onOpenImage: (src: string) => void;
  conversationMessageList: React.ReactNode;
  aiResponseScrollRef: React.RefObject<HTMLDivElement | null>;
  parseSenderMeta: (text: string) => { label?: string; time?: string; cleanText: string };
  normalizeImageSrc: (data: string, mimeType?: string) => string;
};

function MarkdownBlock({ content, className }: { content: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

export function ConversationDetail({
  activeConversation,
  agentName,
  statusLabel,
  userExpanded,
  onUserExpandedChange,
  onBack,
  onOpenImage,
  conversationMessageList,
  aiResponseScrollRef,
  parseSenderMeta,
  normalizeImageSrc,
}: ConversationDetailProps) {
  const msgs = activeConversation.previewMessages ?? [];
  const lastUserMsg = [...msgs].reverse().find((m) => m.role?.toLowerCase() === "user");
  const rawText = lastUserMsg?.text ?? "";
  const { label, time, cleanText } = parseSenderMeta(rawText);
  const imageParts = (lastUserMsg?.parts ?? []).filter((part) => part.kind === "image") as Array<Extract<MessagePart, { kind: "image" }>>;
  const shouldShowExpand = cleanText.length > 120 || cleanText.split("\n").length > 3;

  return (
    <div className="conversation-detail-shell">
      <div className="conversation-detail-statusbar">
        <button className="back-icon-button" onClick={onBack} type="button" title="返回列表">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span className="statusbar-agent">{agentName}</span>
        <span className="statusbar-divider">·</span>
        <span className="statusbar-title">{activeConversation.title}</span>
        <span className="statusbar-divider">·</span>
        <span className="statusbar-tokens">总: {activeConversation.tokens}</span>
        <span className="statusbar-divider">·</span>
        <span className={`statusbar-badge ${activeConversation.status}`}>{statusLabel[activeConversation.status]}</span>
      </div>

      <div className="conversation-detail-scroll">
        <div className="conversation-window-page in-app">
          <section className="conversation-turn-section">
            <div className="last-user-message">
              <div className="last-user-header">
                <span className="message-role-label">User</span>
                <div className="message-meta-right">
                  {label && <span className="message-source-badge">{label}</span>}
                  {time && <span className="message-time-badge">{time}</span>}
                </div>
              </div>
              <div className={`last-user-text ${userExpanded ? "expanded" : "clamped"}`}>
                <MarkdownBlock content={cleanText} className="markdown-body" />
              </div>
              {imageParts.length > 0 && (
                <div className="message-image-grid">
                  {imageParts.map((part, index) => {
                    const src = normalizeImageSrc(part.data, part.mime_type);
                    return (
                      <button className="message-image-card" type="button" key={`user-image-${index}`} onClick={() => onOpenImage(src)}>
                        <img className="message-image" src={src} alt={part.alt ?? `用户图片 ${index + 1}`} />
                      </button>
                    );
                  })}
                </div>
              )}
              {shouldShowExpand && !userExpanded && (
                <button className="expand-btn" type="button" onClick={() => onUserExpandedChange(true)}>
                  展开
                </button>
              )}
              {shouldShowExpand && userExpanded && (
                <button className="expand-btn" type="button" onClick={() => onUserExpandedChange(false)}>
                  收起
                </button>
              )}
            </div>

            <div className="ai-response-scroll" ref={aiResponseScrollRef}>
              {conversationMessageList}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
