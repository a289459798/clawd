import { useEffect, useRef, useState, type RefObject } from "react";
import { ConversationComposer } from "./ConversationComposer";
import { ConversationDetail } from "./ConversationDetail";
import { ConversationList } from "./ConversationList";
import { FocusAssistantMessageList, FullConversationMessageList } from "./ConversationMessageList";
import { getConversationDetailState } from "../lib/conversationDetailState";
import { isConversationRunning } from "../lib/conversationRunState";
import { ensureSelectedModelOption } from "../lib/modelOptions";
import type { ComposerAttachment, ModelOption, QueuedComposerMessage } from "../types/app";
import type { Conversation } from "../types/conversation";
import type { SendShortcut } from "../types/settings";

type TranslateFn = (key: string) => string;
const tt = (t: TranslateFn, key: string, fallback: string) => {
  const value = t(key);
  return value === key ? fallback : value;
};

type VisibleConversation = Conversation & {
  agentId: string;
  agentName: string;
  color: string;
};

type ConversationWorkspaceProps = {
  t: TranslateFn;
  activeConversation: Conversation | null;
  defaultDisplayMode: "focus" | "conversation";
  sendShortcut: SendShortcut;
  visibleConversationCount: number;
  conversationFiltersActive: boolean;
  onClearConversationFilters: () => void;
  visibleConversations: VisibleConversation[];
  filteredVisibleConversations: VisibleConversation[];
  conversationSearch: string;
  conversationRuntimeFilter: string;
  conversationRuntimeOptions: Array<{ value: string; label: string; count: number }>;
  conversationSort: "updated" | "tokens" | "status";
  statusLabel: Record<Conversation["status"], string>;
  userExpanded: boolean;
  aiResponseScrollRef: RefObject<HTMLDivElement | null>;
  showJumpToBottom: boolean;
  shouldStickToBottomRef: { current: boolean };
  composerFocused: boolean;
  composerValue: string;
  composerModel: string;
  composerThinking: string;
  composerThinkingOptions?: Array<{ value: string; label: string }>;
  sending: boolean;
  composerAttachments: ComposerAttachment[];
  activeQueuedMessages: QueuedComposerMessage[];
  gatewayError: string | null;
  modelOptions: ModelOption[];
  modelsLoading: boolean;
  onBack: () => void;
  onUserExpandedChange: (expanded: boolean) => void;
  onJumpToBottomHidden: () => void;
  onUpdateTitle: (conversationId: string, newTitle: string) => Promise<void>;
  parseSenderMeta: (text: string) => { label?: string; time?: string; cleanText: string };
  onOpenImage: (src: string) => void;
  formatTokenCount: (value?: number) => string;
  onOpenConversation: (conversationId: string) => void | Promise<void>;
  onHideConversation: (agentId: string, conversationId: string) => void;
  onConversationSearchChange: (value: string) => void;
  onConversationRuntimeFilterChange: (value: string) => void;
  onConversationSortChange: (value: "updated" | "tokens" | "status") => void;
  onFocusChange: (focused: boolean) => void;
  onValueChange: (value: string) => void;
  onModelChange: (model: string) => void;
  onThinkingChange: (thinking: string) => void;
  onFilesSelected: (files: FileList | null) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onRemoveQueuedMessage: (messageId: string) => void;
  onSend: () => void;
  onAbort: () => void;
  sessionOverrideResetEnabled?: boolean;
  onResetThinkingDefault?: () => void | Promise<void>;
  onResetFastDefault?: () => void | Promise<void>;
  sessionActionBusy: string | null;
  sessionActionError: string | null;
  onCopySessionKey: (conversationId: string) => Promise<void> | void;
  onCompactSession: (conversationId: string) => Promise<void> | void;
  onResetSession: (conversationId: string) => Promise<void> | void;
  onDeleteSession: (conversationId: string) => Promise<void> | void;
  /** Short polite announcements for session switch / visibility (aria-live). */
  workspaceAnnouncement: string | null;
};

export function ConversationWorkspace({
  t,
  activeConversation,
  defaultDisplayMode,
  sendShortcut,
  visibleConversationCount,
  conversationFiltersActive,
  onClearConversationFilters,
  visibleConversations,
  filteredVisibleConversations,
  conversationSearch,
  conversationRuntimeFilter,
  conversationRuntimeOptions,
  conversationSort,
  statusLabel,
  userExpanded,
  aiResponseScrollRef,
  showJumpToBottom,
  shouldStickToBottomRef,
  composerFocused,
  composerValue,
  composerModel,
  composerThinking,
  composerThinkingOptions,
  sending,
  composerAttachments,
  activeQueuedMessages,
  gatewayError,
  modelOptions,
  modelsLoading,
  onBack,
  onUserExpandedChange,
  onJumpToBottomHidden,
  onUpdateTitle,
  parseSenderMeta,
  onOpenImage,
  formatTokenCount,
  onOpenConversation,
  onHideConversation,
  onConversationSearchChange,
  onConversationRuntimeFilterChange,
  onConversationSortChange,
  onFocusChange,
  onValueChange,
  onModelChange,
  onThinkingChange,
  onFilesSelected,
  onRemoveAttachment,
  onRemoveQueuedMessage,
  onSend,
  onAbort,
  sessionOverrideResetEnabled,
  onResetThinkingDefault,
  onResetFastDefault,
  sessionActionBusy,
  sessionActionError,
  onCopySessionKey,
  onCompactSession,
  onResetSession,
  onDeleteSession,
  workspaceAnnouncement,
}: ConversationWorkspaceProps) {
  const defaultDisplayModeRef = useRef(defaultDisplayMode);
  const [detailDisplayMode, setDetailDisplayMode] = useState<"focus" | "conversation">(defaultDisplayMode);
  const [transcriptScrollCompact, setTranscriptScrollCompact] = useState(false);

  useEffect(() => {
    defaultDisplayModeRef.current = defaultDisplayMode;
  }, [defaultDisplayMode]);

  useEffect(() => {
    setTranscriptScrollCompact(false);
  }, [activeConversation?.id]);

  useEffect(() => {
    setDetailDisplayMode(defaultDisplayModeRef.current);
  }, [activeConversation?.id]);

  const renderFocusModeContent = () => {
    if (!activeConversation) return null;
    const detailState = getConversationDetailState(
      activeConversation.previewMessages ?? [],
      activeConversation.lastRole,
      false,
    );
    const shouldShowInProgress = isConversationRunning(activeConversation) || (!gatewayError && detailState.isWaitingReply) || detailState.isStillStreaming;
    if (!detailState.hasRenderableContent && !shouldShowInProgress) return <p className="ai-empty-hint">{tt(t, "conversation.emptyReply", "No reply content yet")}</p>;

    return (
      <>
        {detailState.hasRenderableContent ? (
          <FocusAssistantMessageList
            t={t}
            messages={detailState.normalizedMessages}
            conversationId={activeConversation.id}
            onOpenImage={onOpenImage}
            formatTokenCount={formatTokenCount}
          />
        ) : null}
        {shouldShowInProgress ? (
          <div className="thinking-indicator-fixed" role="status" aria-live="polite">
            <div className="thinking-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        ) : null}
      </>
    );
  };

  const handleDisplayModeChange = (mode: "focus" | "conversation") => {
    shouldStickToBottomRef.current = true;
    onJumpToBottomHidden();
    setDetailDisplayMode(mode);
  };

  const renderConversationModeContent = () => {
    if (!activeConversation) return null;
    const detailState = getConversationDetailState(
      activeConversation.previewMessages ?? [],
      activeConversation.lastRole,
      true,
    );
    const shouldShowInProgress = isConversationRunning(activeConversation) || (!gatewayError && detailState.isStillStreaming);
    if (!detailState.hasRenderableContent && !shouldShowInProgress) return <p className="ai-empty-hint">{tt(t, "conversation.emptyConversation", "No conversation content yet")}</p>;

    return (
      <>
        {detailState.hasRenderableContent ? (
          <FullConversationMessageList
            t={t}
            messages={detailState.normalizedMessages}
            conversationId={activeConversation.id}
            onOpenImage={onOpenImage}
            formatTokenCount={formatTokenCount}
          />
        ) : null}
        {shouldShowInProgress ? (
          <div className="thinking-indicator-fixed" role="status" aria-live="polite">
            <div className="thinking-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        ) : null}
      </>
    );
  };

  return (
    <section className="workspace-area chat-workspace-area">
      {workspaceAnnouncement ? (
        <div className="workspace-action-announcement" role="status" aria-live="polite">
          {workspaceAnnouncement}
        </div>
      ) : null}
      {activeConversation ? (
        <>
          <ConversationDetail
            activeConversation={activeConversation}
            agentName={visibleConversations.find((conversation) => conversation.id === activeConversation.id)?.agentName ?? tt(t, "conversation.unknownAgent", "Unknown agent")}
            t={t}
            statusLabel={statusLabel}
            gatewayError={gatewayError}
            onBack={(resetUserExpanded) => { onBack(); resetUserExpanded(); }}
            resetUserExpanded={() => onUserExpandedChange(false)}
            parseSenderMeta={parseSenderMeta}
            userExpanded={userExpanded}
            onUserExpandedChange={onUserExpandedChange}
            aiResponseScrollRef={aiResponseScrollRef}
            onTranscriptScrollAwayFromBottom={(away) => setTranscriptScrollCompact(away)}
            showJumpToBottom={showJumpToBottom}
            displayMode={detailDisplayMode}
            onDisplayModeChange={handleDisplayModeChange}
            onJumpToBottom={() => {
              const container = aiResponseScrollRef.current;
              if (!container) return;
              container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
              shouldStickToBottomRef.current = true;
              onJumpToBottomHidden();
            }}
            onUpdateTitle={onUpdateTitle}
            sessionActionBusy={sessionActionBusy}
            sessionActionError={sessionActionError}
            onCopySessionKey={onCopySessionKey}
            onCompactSession={onCompactSession}
            onResetSession={onResetSession}
            onDeleteSession={onDeleteSession}
            onAbortSession={onAbort}
            conversationMessageList={detailDisplayMode === "focus" ? renderFocusModeContent() : renderConversationModeContent()}
          />

          <ConversationComposer
            t={t}
            transcriptScrollCompact={transcriptScrollCompact}
            focused={composerFocused}
            value={composerValue}
            model={composerModel}
            thinking={composerThinking}
            sending={sending}
            attachments={composerAttachments}
            queuedMessages={activeQueuedMessages}
            modelOptions={ensureSelectedModelOption(modelOptions, composerModel)}
            thinkingOptions={composerThinkingOptions ?? activeConversation.thinkingOptions}
            modelsLoading={modelsLoading}
            sendShortcut={sendShortcut}
            onFocusChange={onFocusChange}
            onValueChange={onValueChange}
            onModelChange={onModelChange}
            onThinkingChange={onThinkingChange}
            onFilesSelected={onFilesSelected}
            onRemoveAttachment={onRemoveAttachment}
            onRemoveQueuedMessage={onRemoveQueuedMessage}
            onSend={onSend}
            onAbort={onAbort}
            sessionOverrideResetEnabled={sessionOverrideResetEnabled}
            onResetThinkingDefault={onResetThinkingDefault}
            onResetFastDefault={onResetFastDefault}
          />
        </>
      ) : (
        <>
          <div className="conversation-list-toolbar">
            <input
              type="search"
              value={conversationSearch}
              onChange={(event) => onConversationSearchChange(event.target.value)}
              placeholder={tt(t, "conversation.searchPlaceholder", "Search conversations, agent, model, or session key")}
              aria-label={tt(t, "conversation.searchAria", "Search conversations")}
            />
            <div className="conversation-sort-select">
              <select
                value={conversationSort}
                onChange={(event) => onConversationSortChange(event.target.value as "updated" | "tokens" | "status")}
                aria-label={tt(t, "conversation.sortAria", "Sort conversations")}
              >
                <option value="updated">{tt(t, "conversation.sort.updated", "Recently updated")}</option>
                <option value="status">{tt(t, "conversation.sort.status", "Runtime status")}</option>
                <option value="tokens">{tt(t, "conversation.sort.tokens", "Token usage")}</option>
              </select>
            </div>
            <div className="conversation-sort-select runtime-filter-select">
              <select
                value={conversationRuntimeFilter}
                onChange={(event) => onConversationRuntimeFilterChange(event.target.value)}
                aria-label={tt(t, "conversation.runtimeFilterAria", "Filter conversations by agent runtime")}
              >
                <option value="all">{tt(t, "conversation.runtimeFilterAll", "All runtimes")}</option>
                {conversationRuntimeOptions.map((runtime) => (
                  <option value={runtime.value} key={runtime.value}>
                    {runtime.label} · {runtime.count}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <ConversationList
            t={t}
            conversations={filteredVisibleConversations}
            statusLabel={statusLabel}
            onOpen={onOpenConversation}
            onHide={onHideConversation}
          />
        </>
      )}
      {!activeConversation && filteredVisibleConversations.length === 0 ? (
        <div className="empty-chat-state">
          {visibleConversationCount > 0 && conversationFiltersActive ? (
            <>
              <strong>{tt(t, "conversation.emptyFilteredTitle", "No conversations match current filters")}</strong>
              <p>{tt(t, "conversation.emptyFilteredHint", "Try adjusting search keywords or runtime filter, or clear filters in one click.")}</p>
              <button type="button" className="ghost-button" onClick={onClearConversationFilters}>
                {tt(t, "conversation.clearFilters", "Clear filters")}
              </button>
            </>
          ) : (
            <>
              <strong>{tt(t, "conversation.emptyTitle", "No conversations to show yet")}</strong>
              <p>{tt(t, "conversation.emptyHint", "Open a conversation from the left agent tree first.")}</p>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
