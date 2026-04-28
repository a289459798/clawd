import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isInternalOpenClawMessage } from "../lib/gatewayMessages";
import type { Conversation, ConversationStatus, MessagePart, PreviewMessage } from "../types/conversation";

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
  onUpdateTitle?: (conversationId: string, newTitle: string) => void;
};

function MarkdownBlock({ content, className }: { content: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function normalizeImageSrc(data: string, mimeType?: string) {
  if (data.startsWith("data:") || data.startsWith("http://") || data.startsWith("https://") || data.startsWith("/") || data.startsWith("file://")) {
    return data;
  }
  return `data:${mimeType || "image/png"};base64,${data}`;
}

function messageContentForHistory(message: PreviewMessage) {
  const parts = message.parts ?? [];
  const textParts = parts
    .filter((part): part is Extract<MessagePart, { kind: "text" }> => part.kind === "text")
    .map((part) => part.text)
    .filter((text) => text?.trim());

  if (textParts.length > 0) {
    return textParts.join("\n\n");
  }

  if (message.text?.trim()) {
    return message.text;
  }

  if (parts.some((part) => part.kind === "image")) {
    return "[图片]";
  }

  if (parts.some((part) => part.kind === "tool_call")) {
    return "[工具调用记录]";
  }

  return "[空消息]";
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
  onUpdateTitle,
}: ConversationDetailProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(activeConversation.title);

  // 同步 titleInput 当 conversation 变化时
  useEffect(() => {
    setTitleInput(activeConversation.title);
  }, [activeConversation.title]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyScrollRef = useRef<HTMLDivElement | null>(null);

  const historyMessages = useMemo(() => {
    return (activeConversation.previewMessages ?? [])
      .filter((message) => {
        if (isInternalOpenClawMessage(message)) return false;
        const role = message.role?.toLowerCase();
        return role === "user" || role === "assistant";
      })
      .map((message) => {
        const role = message.role?.toLowerCase() === "user" ? "user" : "assistant";
        const rawContent = messageContentForHistory(message);
        const parsed = role === "user" ? parseSenderMeta(rawContent) : undefined;
        return {
          role,
          label: role === "user" ? message.senderLabel ?? parsed?.label ?? "用户" : "AI",
          time: message.timestamp
            ? new Date(message.timestamp).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
            : parsed?.time,
          content: role === "user" ? parsed?.cleanText ?? rawContent : rawContent,
        };
      });
  }, [activeConversation.previewMessages, parseSenderMeta]);

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

  useEffect(() => {
    if (!historyOpen) return;
    const scrollContainer = historyScrollRef.current;
    if (!scrollContainer) return;

    requestAnimationFrame(() => {
      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: "auto",
      });
    });
  }, [historyOpen, activeConversation.id, historyMessages.length]);

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
        {isEditingTitle ? (
          <input
            type="text"
            className="statusbar-title-input"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onBlur={() => {
              setIsEditingTitle(false);
              if (titleInput.trim() && titleInput !== activeConversation.title) {
                onUpdateTitle?.(activeConversation.id, titleInput.trim());
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setIsEditingTitle(false);
                if (titleInput.trim() && titleInput !== activeConversation.title) {
                  onUpdateTitle?.(activeConversation.id, titleInput.trim());
                }
              }
              if (e.key === "Escape") {
                setIsEditingTitle(false);
                setTitleInput(activeConversation.title);
              }
            }}
            autoFocus
            style={{
              background: "transparent",
              border: "1px solid var(--border, #ffffff30)",
              borderRadius: "4px",
              color: "inherit",
              fontSize: "inherit",
              padding: "2px 8px",
              outline: "none",
              flex: "1",
              minWidth: "120px",
            }}
          />
        ) : (
          <span
            className="statusbar-title"
            onClick={() => setIsEditingTitle(true)}
            title="点击编辑"
            style={{ cursor: "pointer" }}
          >
            {activeConversation.title}
          </span>
        )}
        <span className="statusbar-divider">·</span>
        <span className="statusbar-tokens">总: {activeConversation.tokens}</span>
        <span className="statusbar-divider">·</span>
        <span className={`statusbar-badge ${activeConversation.status}`}>{statusLabel[activeConversation.status]}</span>
        <button
          className={`history-icon-button ${historyOpen ? "active" : ""}`}
          onClick={() => setHistoryOpen((open) => !open)}
          type="button"
          title={historyOpen ? "收起消息记录" : "展开消息记录"}
          aria-label={historyOpen ? "收起消息记录" : "展开消息记录"}
          aria-pressed={historyOpen}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H9l-5 4v-4.5A2.5 2.5 0 0 1 2 13V5.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M7 8h10M7 11.5h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className={`conversation-detail-scroll ${historyOpen ? "with-history" : "without-history"}`}>
        <div className="conversation-window-page in-app">
          <section className="conversation-turn-section">
            {(() => {
              const msgs = (activeConversation.previewMessages ?? []).filter((message) => !isInternalOpenClawMessage(message));
              const lastUserMsg = [...msgs].reverse().find((m) => m.role?.toLowerCase() === "user");
              const rawText = lastUserMsg?.text ?? "";
              const parsed = parseSenderMeta(rawText);
              // Use senderLabel and timestamp from message if available, otherwise fall back to parsed values
              const label = lastUserMsg?.senderLabel ?? parsed.label;
              // Format timestamp from message or parsed time
              const time = lastUserMsg?.timestamp
                ? new Date(lastUserMsg.timestamp).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                : parsed.time;
              const cleanText = parsed.cleanText;
              const userImages = (lastUserMsg?.parts ?? []).filter((part): part is Extract<MessagePart, { kind: "image" }> => part.kind === "image");
              const lineCount = cleanText.split("\n").length;
              const shouldShowExpand = cleanText.length > 80 || lineCount > 2;
              return lastUserMsg ? (
                <div className="top-user-message">
                  <div className="top-user-meta">
                    {label ? <span className="top-user-badge">{label}</span> : null}
                    {time ? <span className="top-user-time">{time}</span> : null}
                  </div>
                  {cleanText ? (
                    <div className={`top-user-text ${userExpanded ? "expanded" : "clamped"}`}>
                      <MarkdownBlock content={cleanText} className="markdown-body" />
                    </div>
                  ) : null}
                  {userImages.length > 0 ? (
                    <div className="top-user-images">
                      {userImages.map((image, index) => (
                        <button className="top-user-image-card" type="button" key={`${lastUserMsg.timestamp ?? "user"}-image-${index}`} title={image.alt ?? "图片"}>
                          <img src={normalizeImageSrc(image.data, image.mime_type)} alt={image.alt ?? "用户发送的图片"} />
                        </button>
                      ))}
                    </div>
                  ) : null}
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
        {historyOpen ? (
          <aside className="history-sidepanel" aria-label="消息记录">
            <div className="history-sidepanel-header">
              <div>
                <strong>消息记录</strong>
                <span>{historyMessages.length} 条</span>
              </div>
            </div>
            <div className="history-sidepanel-body" ref={historyScrollRef}>
              {historyMessages.length > 0 ? (
                <div className="history-message-list">
                  {historyMessages.map((message, index) => (
                    <article className={`history-message-row ${message.role}`} key={`${activeConversation.id}-history-${index}`}>
                      <div className="history-message-meta">
                        <span className="history-message-role">{message.label}</span>
                        {message.time ? <span className="history-message-time">{message.time}</span> : null}
                      </div>
                      <div className={`history-message-bubble ${message.role}`}>
                        <MarkdownBlock content={message.content} className="markdown-body" />
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="history-empty-hint">暂无消息记录</p>
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
