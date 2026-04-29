import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isInternalOpenClawMessage } from "../lib/gatewayMessages";
import type { Conversation, ConversationStatus, MessagePart } from "../types/conversation";

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
  displayMode: "focus" | "conversation";
  onDisplayModeChange: (mode: "focus" | "conversation") => void;
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
  displayMode,
  onDisplayModeChange,
  onJumpToBottom,
  onUpdateTitle,
}: ConversationDetailProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(activeConversation.title);

  // 同步 titleInput 当 conversation 变化时
  useEffect(() => {
    setTitleInput(activeConversation.title);
  }, [activeConversation.title]);

  // Mode changes remount the content area, so wait for the new subtree before scrolling.
  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const scrollContainer = aiResponseScrollRef.current;
        if (!scrollContainer) return;
        scrollContainer.scrollTo({
          top: scrollContainer.scrollHeight,
          behavior: "auto",
        });
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [activeConversation.id, aiResponseScrollRef, displayMode]);

  // Keep new incoming messages pinned to the latest reply by default.
  useEffect(() => {
    const scrollContainer = aiResponseScrollRef.current;
    if (!scrollContainer) return;
    const frame = requestAnimationFrame(() => {
      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: "auto",
      });
    });
    return () => cancelAnimationFrame(frame);
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
        <div className="detail-mode-toggle" role="group" aria-label="详情展示模式">
          <button
            className={displayMode === "focus" ? "active" : ""}
            type="button"
            onClick={() => onDisplayModeChange("focus")}
            aria-pressed={displayMode === "focus"}
          >
            专注
          </button>
          <button
            className={displayMode === "conversation" ? "active" : ""}
            type="button"
            onClick={() => onDisplayModeChange("conversation")}
            aria-pressed={displayMode === "conversation"}
          >
            对话
          </button>
        </div>
      </div>

      <div className="conversation-detail-scroll">
        <div className="conversation-window-page in-app">
          <section className={`conversation-turn-section ${displayMode}-page`} key={`${activeConversation.id}-${displayMode}`}>
            {displayMode === "focus" ? (() => {
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
            })() : null}
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
