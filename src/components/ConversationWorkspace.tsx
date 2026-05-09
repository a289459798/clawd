import { useEffect, useRef, useState, type RefObject } from "react";
import { ConversationComposer } from "./ConversationComposer";
import { ConversationDetail } from "./ConversationDetail";
import { ConversationList } from "./ConversationList";
import { FocusAssistantMessageList, FullConversationMessageList } from "./ConversationMessageList";
import { getConversationDetailState } from "../lib/conversationDetailState";
import { ensureSelectedModelOption } from "../lib/modelOptions";
import type { ComposerAttachment, ModelOption, QueuedComposerMessage } from "../types/app";
import type { Conversation } from "../types/conversation";
import type { SendShortcut } from "../types/settings";

type VisibleConversation = Conversation & {
  agentId: string;
  agentName: string;
  color: string;
};

type ConversationWorkspaceProps = {
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
    const shouldShowInProgress = activeConversation.runtime?.activeRunId || (!gatewayError && detailState.isWaitingReply) || detailState.isStillStreaming;
    if (!detailState.hasRenderableContent && !shouldShowInProgress) return <p className="ai-empty-hint">暂无回复内容</p>;

    return (
      <>
        {detailState.hasRenderableContent ? (
          <FocusAssistantMessageList
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
    const shouldShowInProgress = activeConversation.runtime?.activeRunId || (!gatewayError && detailState.isStillStreaming);
    if (!detailState.hasRenderableContent && !shouldShowInProgress) return <p className="ai-empty-hint">暂无对话内容</p>;

    return (
      <>
        {detailState.hasRenderableContent ? (
          <FullConversationMessageList
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
            agentName={visibleConversations.find((conversation) => conversation.id === activeConversation.id)?.agentName ?? "未知 Agent"}
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
          />
        </>
      ) : (
        <>
          <div className="conversation-list-toolbar">
            <input
              type="search"
              value={conversationSearch}
              onChange={(event) => onConversationSearchChange(event.target.value)}
              placeholder="搜索对话、Agent、模型或 session key"
              aria-label="搜索对话"
            />
            <div className="conversation-sort-select">
              <select
                value={conversationSort}
                onChange={(event) => onConversationSortChange(event.target.value as "updated" | "tokens" | "status")}
                aria-label="排序对话"
              >
                <option value="updated">最近更新</option>
                <option value="status">运行状态</option>
                <option value="tokens">Token 用量</option>
              </select>
            </div>
            <div className="conversation-sort-select runtime-filter-select">
              <select
                value={conversationRuntimeFilter}
                onChange={(event) => onConversationRuntimeFilterChange(event.target.value)}
                aria-label="按 Agent Runtime 筛选对话"
              >
                <option value="all">全部 Runtime</option>
                {conversationRuntimeOptions.map((runtime) => (
                  <option value={runtime.value} key={runtime.value}>
                    {runtime.label} · {runtime.count}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <ConversationList
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
              <strong>没有符合筛选条件的对话</strong>
              <p>试着调整搜索关键词或 Runtime 筛选；也可一键清空筛选。</p>
              <button type="button" className="ghost-button" onClick={onClearConversationFilters}>
                清空筛选
              </button>
            </>
          ) : (
            <>
              <strong>还没有可显示的对话</strong>
              <p>先从左侧 Agent 树里展开一个会话，后续这里会支持直接新建对话。</p>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
