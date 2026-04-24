import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Conversation, ConversationStatus } from "../types/conversation";

type ConversationDetailProps = {
  activeConversation: Conversation;
  agentName: string;
  statusLabel: Record<ConversationStatus, string>;
  onBack: (resetUserExpanded: () => void) => void;
  resetUserExpanded: () => void;
  conversationMessageList: React.ReactNode;
  aiResponseScrollRef: React.RefObject<HTMLDivElement | null>;
  parseSenderMeta: (text: string) => { label?: string; time?: string; cleanText: string };
  userExpanded: boolean;
  onUserExpandedChange: (expanded: boolean) => void;
  showJumpToBottom: boolean;
  onJumpToBottom: () => void;
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
  onBack,
  resetUserExpanded,
  conversationMessageList,
  aiResponseScrollRef,
  parseSenderMeta,
  userExpanded,
  onUserExpandedChange,
  showJumpToBottom,
  onJumpToBottom,
}: ConversationDetailProps) {
  // Auto scroll to bottom when entering conversation or when messages change
  useEffect(() => {
    const scrollContainer = aiResponseScrollRef.current;
    if (!scrollContainer) return;
    
    // Use requestAnimationFrame to ensure content is rendered before scrolling
    requestAnimationFrame(() => {
      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: "auto",
      });
    });
  }, [activeConversation.id, activeConversation.previewMessages?.length, aiResponseScrollRef]);

  return (
    <div className="conversation-detail-shell">
      <div className="conversation-detail-statusbar">
        <button className="back-icon-button" onClick={() => onBack(resetUserExpanded)} type="button" title="返回列表">
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

      <div className="conversation-detail-scroll without-history">
        <div className="conversation-window-page in-app">
          <section className="conversation-turn-section">
            {(() => {
              const msgs = activeConversation.previewMessages ?? [];
              const lastUserMsg = [...msgs].reverse().find((m) => m.role?.toLowerCase() === "user");
              const rawText = lastUserMsg?.text ?? "";
              const { label, time, cleanText } = parseSenderMeta(rawText);
              const shouldShowExpand = cleanText.length > 80 || cleanText.split("\n").length > 2;
              return lastUserMsg ? (
                <div className="top-user-message">
                  <div className="top-user-meta">
                    {label ? <span className="top-user-badge">{label}</span> : null}
                    {time ? <span className="top-user-time">{time}</span> : null}
                  </div>
                  <div className={`top-user-text ${userExpanded ? "expanded" : "clamped"}`}>
                    <MarkdownBlock content={cleanText} className="markdown-body" />
                  </div>
                  {shouldShowExpand ? (
                    <button className="top-user-expand" type="button" onClick={() => onUserExpandedChange(!userExpanded)} title={userExpanded ? "收起" : "展开"}>
                      {userExpanded ? "⌃" : "⌄"}
                    </button>
                  ) : null}
                </div>
              ) : null;
            })()}
            <div className="ai-response-scroll" ref={aiResponseScrollRef}>
              {conversationMessageList}
            </div>
            {showJumpToBottom ? (
              <button className="jump-to-bottom-button" type="button" onClick={onJumpToBottom} title="回到底部">
                ↓
              </button>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
