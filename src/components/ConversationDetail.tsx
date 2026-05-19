import { useEffect, useRef, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getLatestUserMessage } from "../lib/conversationDetailState";
import { isConversationRunning } from "../lib/conversationRunState";
import { fileKindLabel, formatFileSize } from "../lib/fileDisplay";
import { isInternalOpenClawMessage } from "../lib/gatewayMessages";
import type { Conversation, ConversationStatus, MessagePart } from "../types/conversation";
import type { ConversationAutoScrollMode } from "../types/settings";

type TranslateFn = (key: string) => string;
const tt = (t: TranslateFn, key: string, fallback: string) => {
  const value = t(key);
  return value === key ? fallback : value;
};

type ConversationDetailProps = {
  t: TranslateFn;
  activeConversation: Conversation;
  agentName: string;
  statusLabel: Record<ConversationStatus, string>;
  onBack: (resetUserExpanded: () => void) => void;
  resetUserExpanded: () => void;
  conversationMessageList: React.ReactNode;
  gatewayError: string | null;
  historyLoading?: boolean;
  historyCanLoadMore?: boolean;
  aiResponseScrollRef: React.RefObject<HTMLDivElement | null>;
  /** Called when user scrolls transcript substantially above bottom (away=true) or back near bottom (false). */
  onTranscriptScrollAwayFromBottom?: (away: boolean) => void;
  parseSenderMeta: (text: string) => { label?: string; time?: string; cleanText: string };
  userExpanded: boolean;
  onUserExpandedChange: (expanded: boolean) => void;
  showJumpToBottom: boolean;
  displayMode: "focus" | "conversation";
  autoScrollMode: ConversationAutoScrollMode;
  onDisplayModeChange: (mode: "focus" | "conversation") => void;
  onJumpToBottom: () => void;
  onLoadMoreHistory?: (conversationId: string) => Promise<void> | void;
  onUpdateTitle?: (conversationId: string, newTitle: string) => Promise<void>;
  sessionActionBusy?: string | null;
  sessionActionError?: string | null;
  onCopySessionKey?: (conversationId: string) => Promise<void> | void;
  onCompactSession?: (conversationId: string) => Promise<void> | void;
  onResetSession?: (conversationId: string) => Promise<void> | void;
  onDeleteSession?: (conversationId: string) => Promise<void> | void;
  onAbortSession?: () => Promise<void> | void;
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

function compactionReasonLabel(reason: string, t: TranslateFn) {
  const map: Record<string, string> = {
    manual: tt(t, "conversation.compaction.manual", "Manual"),
    "auto-threshold": tt(t, "conversation.compaction.autoThreshold", "Auto threshold"),
    "overflow-retry": tt(t, "conversation.compaction.overflowRetry", "Overflow retry"),
    "timeout-retry": tt(t, "conversation.compaction.timeoutRetry", "Timeout retry"),
  };
  return map[reason] ?? reason;
}

export function ConversationDetail({
  t,
  activeConversation,
  agentName,
  statusLabel,
  onBack,
  resetUserExpanded,
  conversationMessageList,
  gatewayError,
  historyLoading,
  historyCanLoadMore,
  aiResponseScrollRef,
  onTranscriptScrollAwayFromBottom,
  parseSenderMeta,
  userExpanded,
  onUserExpandedChange,
  showJumpToBottom,
  displayMode,
  autoScrollMode,
  onDisplayModeChange,
  onJumpToBottom,
  onLoadMoreHistory,
  onUpdateTitle,
  sessionActionBusy,
  sessionActionError,
  onCopySessionKey,
  onCompactSession,
  onResetSession,
  onDeleteSession,
  onAbortSession,
}: ConversationDetailProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(activeConversation.title);
  const [openFileError, setOpenFileError] = useState<string | null>(null);
  const [titleFeedback, setTitleFeedback] = useState<null | "saving" | "saved" | "error">(null);
  const titleFeedbackClearRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 同步 titleInput 当 conversation 变化时
  useEffect(() => {
    setTitleInput(activeConversation.title);
  }, [activeConversation.title]);

  useEffect(() => {
    setTitleFeedback(null);
    if (titleFeedbackClearRef.current) {
      clearTimeout(titleFeedbackClearRef.current);
      titleFeedbackClearRef.current = undefined;
    }
  }, [activeConversation.id]);

  useEffect(() => () => {
    if (titleFeedbackClearRef.current) {
      clearTimeout(titleFeedbackClearRef.current);
    }
  }, []);

  const commitTitleEdit = async () => {
    const next = titleInput.trim();
    if (!next) {
      setIsEditingTitle(false);
      setTitleInput(activeConversation.title);
      return;
    }
    if (next === activeConversation.title) {
      setIsEditingTitle(false);
      return;
    }
    if (!onUpdateTitle) {
      setIsEditingTitle(false);
      return;
    }
    setIsEditingTitle(false);
    setTitleFeedback("saving");
    try {
      await onUpdateTitle(activeConversation.id, next);
      setTitleFeedback("saved");
      titleFeedbackClearRef.current = setTimeout(() => {
        setTitleFeedback(null);
        titleFeedbackClearRef.current = undefined;
      }, 2200);
    } catch {
      setTitleFeedback("error");
      setTitleInput(activeConversation.title);
      titleFeedbackClearRef.current = setTimeout(() => {
        setTitleFeedback(null);
        titleFeedbackClearRef.current = undefined;
      }, 4200);
    }
  };

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

  // Manual mode leaves incoming replies in place and lets the jump button carry the update.
  useEffect(() => {
    if (autoScrollMode === "manual") return;
    const scrollContainer = aiResponseScrollRef.current;
    if (!scrollContainer) return;
    if (autoScrollMode === "nearBottom") {
      const distanceFromBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
      if (distanceFromBottom > 120) return;
    }
    const frame = requestAnimationFrame(() => {
      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: "auto",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeConversation.id, activeConversation.previewMessages?.length, aiResponseScrollRef, autoScrollMode]);

  return (
    <div className="conversation-detail-shell">
      <div className="conversation-detail-statusbar">
        <button className="back-icon-button" onClick={() => onBack(resetUserExpanded)} type="button" title={tt(t, "conversation.backToList", "Back to list")}>
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
              void commitTitleEdit();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commitTitleEdit();
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
            title={tt(t, "conversation.clickToEdit", "Click to edit")}
            style={{ cursor: "pointer" }}
          >
            {activeConversation.title}
          </span>
        )}
        {titleFeedback ? (
          <span
            className={`statusbar-title-feedback ${titleFeedback}`}
            role="status"
            aria-live="polite"
          >
            {titleFeedback === "saving" ? tt(t, "common.saving", "Saving...") : null}
            {titleFeedback === "saved" ? tt(t, "common.saved", "Saved") : null}
            {titleFeedback === "error" ? tt(t, "common.saveFailed", "Save failed") : null}
          </span>
        ) : null}
        <span className="statusbar-divider">·</span>
        <span className="statusbar-tokens">{tt(t, "conversation.totalTokens", "Total")}: {activeConversation.tokens}</span>
        {activeConversation.agentRuntime ? (
          <>
            <span className="statusbar-divider">·</span>
            <span className="statusbar-runtime" title={`Agent Runtime: ${activeConversation.agentRuntime.id}`}>
              {activeConversation.agentRuntime.label ?? activeConversation.agentRuntime.id}
            </span>
          </>
        ) : null}
        <span className="statusbar-divider">·</span>
        <span className={`statusbar-badge ${activeConversation.status}`}>{statusLabel[activeConversation.status]}</span>
        <div className="detail-mode-toggle" role="group" aria-label={tt(t, "conversation.detailMode", "Detail display mode")}>
          <button
            className={displayMode === "focus" ? "active" : ""}
            type="button"
            onClick={() => onDisplayModeChange("focus")}
            aria-pressed={displayMode === "focus"}
          >
            {tt(t, "settings.option.focus", "Focus")}
          </button>
          <button
            className={displayMode === "conversation" ? "active" : ""}
            type="button"
            onClick={() => onDisplayModeChange("conversation")}
            aria-pressed={displayMode === "conversation"}
          >
            {tt(t, "settings.option.conversation", "Conversation")}
          </button>
        </div>
        <details className="session-action-menu">
          <summary aria-label={tt(t, "conversation.actions", "Conversation actions")} title={tt(t, "conversation.actions", "Conversation actions")}>
            <span className="session-action-menu-icon" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </summary>
          <div className="session-action-popover">
            <button
              type="button"
              onClick={() => void onCopySessionKey?.(activeConversation.id)}
              disabled={!onCopySessionKey || Boolean(sessionActionBusy)}
            >
              <span>{tt(t, "conversation.copySessionId", "Copy session ID")}</span>
              <small>{tt(t, "conversation.copySessionIdHint", "For troubleshooting or locating this session in CLI")}</small>
            </button>
            {isConversationRunning(activeConversation) ? (
              <button
                type="button"
                onClick={() => void onAbortSession?.()}
                disabled={!onAbortSession || Boolean(sessionActionBusy)}
              >
                <span>{sessionActionBusy === "abort" ? tt(t, "conversation.stopping", "Stopping...") : tt(t, "conversation.stopCurrentRun", "Stop current run")}</span>
                <small>{tt(t, "conversation.stopCurrentRunHint", "Stops only ongoing generation, keeps conversation content")}</small>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void onCompactSession?.(activeConversation.id)}
              disabled={!onCompactSession || Boolean(sessionActionBusy)}
            >
              <span>{sessionActionBusy === "compact" ? tt(t, "conversation.compacting", "Compacting...") : tt(t, "conversation.compactContext", "Compact context")}</span>
              <small>{tt(t, "conversation.compactContextHint", "Lighten long conversations while keeping entry and visible history")}</small>
            </button>
            <button
              type="button"
              onClick={() => void onResetSession?.(activeConversation.id)}
              disabled={!onResetSession || Boolean(sessionActionBusy)}
            >
              <span>{sessionActionBusy === "reset" ? tt(t, "conversation.processing", "Processing...") : tt(t, "conversation.restart", "Restart")}</span>
              <small>{tt(t, "conversation.restartHint", "Clear this session context while keeping the entry")}</small>
            </button>
            <button
              className="danger"
              type="button"
              onClick={() => void onDeleteSession?.(activeConversation.id)}
              disabled={!onDeleteSession || Boolean(sessionActionBusy)}
            >
              <span>{sessionActionBusy === "delete" ? tt(t, "conversation.deleting", "Deleting...") : tt(t, "conversation.deleteSession", "Delete session")}</span>
              <small>{tt(t, "conversation.deleteSessionHint", "Remove from OpenClaw session list with confirmation")}</small>
            </button>
            {sessionActionError ? (
              <div className="session-action-error" role="alert">
                {sessionActionError}
              </div>
            ) : null}
          </div>
        </details>
      </div>

      {(() => {
        const transcriptIssue =
          activeConversation.transcriptPreviewStatus === "missing" || activeConversation.transcriptPreviewStatus === "error";
        const compactionVisible =
          (activeConversation.compactionCheckpointCount ?? 0) > 0 || Boolean(activeConversation.latestCompactionCheckpoint);
        if (!transcriptIssue && !compactionVisible) {
          return null;
        }
        const cp = activeConversation.latestCompactionCheckpoint;
        const compactionTitle =
          cp &&
          `checkpoint ${cp.checkpointId} · ${new Date(cp.createdAt).toLocaleString()} · ${compactionReasonLabel(cp.reason, t)}`;
        return (
          <div className="conversation-detail-maintenance" role="status">
            {transcriptIssue ? (
              <div className="conversation-detail-maintenance-item transcript-issue">
                {activeConversation.transcriptPreviewStatus === "missing"
                  ? tt(t, "conversation.transcriptMissing", "Gateway: transcript may be missing while session index still exists.")
                  : tt(t, "conversation.transcriptReadFailed", "Gateway: failed to read session preview, please retry later or check Gateway logs.")}
              </div>
            ) : null}
            {compactionVisible ? (
              <div className="conversation-detail-maintenance-item compaction-info" title={compactionTitle ?? undefined}>
                {tt(t, "conversation.compactionOccurred", "Context was compacted")}
                {typeof activeConversation.compactionCheckpointCount === "number"
                  ? ` (${activeConversation.compactionCheckpointCount} ${tt(t, "conversation.checkpoints", "checkpoints")})`
                  : cp
                    ? ` · ${compactionReasonLabel(cp.reason, t)}`
                    : null}
              </div>
            ) : null}
          </div>
        );
      })()}

      <div className="conversation-detail-scroll">
        <div className="conversation-window-page in-app">
          <section className={`conversation-turn-section ${displayMode}-page`} key={`${activeConversation.id}-${displayMode}`}>
            {displayMode === "focus" ? (() => {
              const msgs = (activeConversation.previewMessages ?? []).filter((message) => !isInternalOpenClawMessage(message));
              const lastUserMsg = getLatestUserMessage(msgs);
              const rawText = lastUserMsg?.text ?? "";
              const parsed = parseSenderMeta(rawText);
              // Use senderLabel and timestamp from message if available, otherwise fall back to parsed values
              const label = lastUserMsg?.senderLabel ?? parsed.label;
              // Format timestamp from message or parsed time
              const time = lastUserMsg?.timestamp
                ? new Date(lastUserMsg.timestamp).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                : parsed.time;
              const cleanText = parsed.cleanText;
              const userImages = (lastUserMsg?.parts ?? []).filter((part): part is Extract<MessagePart, { kind: "image" }> => part.kind === "image");
              const userFiles = (lastUserMsg?.parts ?? []).filter((part): part is Extract<MessagePart, { kind: "file" }> => part.kind === "file");
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
                        <button className="top-user-image-card" type="button" key={`${lastUserMsg.timestamp ?? "user"}-image-${index}`} title={image.alt ?? tt(t, "conversation.image", "Image")}>
                          <img src={normalizeImageSrc(image.data, image.mime_type)} alt={image.alt ?? tt(t, "conversation.userImageAlt", "User image")} />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {userFiles.length > 0 ? (
                    <div className="top-user-files">
                      {userFiles.map((file, index) => (
                        <button
                          className={`top-user-file-card ${file.path ? "clickable" : ""}`}
                          key={`${lastUserMsg.timestamp ?? "user"}-file-${index}`}
                          type="button"
                          disabled={!file.path}
                          title={file.path ? `${tt(t, "common.open", "Open")} ${file.path}` : file.name}
                          onClick={async () => {
                            if (!file.path) return;
                            try {
                              setOpenFileError(null);
                              await openPath(file.path);
                            } catch (error) {
                              setOpenFileError(error instanceof Error ? error.message : String(error));
                            }
                          }}
                        >
                          <span className="top-user-file-kind">{fileKindLabel(file.mime_type, file.name)}</span>
                          <span className="top-user-file-name">{file.name}</span>
                          <span className="top-user-file-size">{formatFileSize(file.size)}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {openFileError ? <div className="top-user-file-error">{tt(t, "conversation.openAttachmentFailed", "Failed to open attachment")}: {openFileError}</div> : null}
                  {shouldShowExpand ? (
                    <button className="top-user-expand" type="button" onClick={() => onUserExpandedChange(!userExpanded)} title={userExpanded ? tt(t, "common.collapse", "Collapse") : tt(t, "common.expand", "Expand")}>
                      {userExpanded ? "⌃" : "⌄"}
                    </button>
                  ) : null}
                </div>
              ) : null;
            })() : null}
            <div
              className="ai-response-scroll"
              ref={aiResponseScrollRef}
              onScroll={() => {
                const scrollContainer = aiResponseScrollRef.current;
                if (!scrollContainer || !onTranscriptScrollAwayFromBottom) return;
                const thresholdPx = 120;
                const distanceFromBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
                onTranscriptScrollAwayFromBottom(distanceFromBottom > thresholdPx);
              }}
            >
              {historyCanLoadMore ? (
                <button
                  className="conversation-load-earlier-button"
                  type="button"
                  disabled={historyLoading}
                  onClick={() => void onLoadMoreHistory?.(activeConversation.id)}
                >
                  {historyLoading ? tt(t, "conversation.loadingEarlier", "Loading earlier messages...") : tt(t, "conversation.loadEarlier", "Load earlier messages")}
                </button>
              ) : null}
              {conversationMessageList}
              {gatewayError ? (
                <div className="conversation-bottom-error" role="alert">
                  <strong>{tt(t, "conversation.sendFailed", "Send failed")}</strong>
                  <span>{gatewayError}</span>
                </div>
              ) : null}
            </div>
            {showJumpToBottom ? (
              <button className="jump-to-bottom-button" type="button" onClick={onJumpToBottom} title={tt(t, "conversation.backToBottom", "Back to bottom")}>
                ↓
              </button>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
