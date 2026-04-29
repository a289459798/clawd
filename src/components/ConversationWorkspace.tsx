import { useEffect, useState, type RefObject } from "react";
import { ConversationComposer } from "./ConversationComposer";
import { ConversationDetail } from "./ConversationDetail";
import { ConversationList } from "./ConversationList";
import { FocusAssistantMessageList, FullConversationMessageList } from "./ConversationMessageList";
import { getConversationDetailState } from "../lib/conversationDetailState";
import { ensureSelectedModelOption } from "../lib/modelOptions";
import type { ComposerAttachment, ModelOption, QueuedComposerMessage } from "../types/app";
import type { Conversation } from "../types/conversation";

type VisibleConversation = Conversation & {
  agentId: string;
  agentName: string;
  color: string;
};

type ConversationWorkspaceProps = {
  activeConversation: Conversation | null;
  visibleConversations: VisibleConversation[];
  filteredVisibleConversations: VisibleConversation[];
  conversationSearch: string;
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
  sending: boolean;
  composerAttachments: ComposerAttachment[];
  activeQueuedMessages: QueuedComposerMessage[];
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
};

export function ConversationWorkspace({
  activeConversation,
  visibleConversations,
  filteredVisibleConversations,
  conversationSearch,
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
  sending,
  composerAttachments,
  activeQueuedMessages,
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
}: ConversationWorkspaceProps) {
  const [detailDisplayMode, setDetailDisplayMode] = useState<"focus" | "conversation">("focus");

  useEffect(() => {
    setDetailDisplayMode("focus");
  }, [activeConversation?.id]);

  const renderFocusModeContent = () => {
    if (!activeConversation) return null;
    const detailState = getConversationDetailState(
      activeConversation.previewMessages ?? [],
      activeConversation.lastRole,
      false,
    );
    const shouldShowInProgress = activeConversation.runtime?.activeRunId || detailState.isWaitingReply || detailState.isStillStreaming;
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
    const shouldShowInProgress = activeConversation.runtime?.activeRunId || detailState.isStillStreaming;
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
      {activeConversation ? (
        <>
          <ConversationDetail
            activeConversation={activeConversation}
            agentName={visibleConversations.find((conversation) => conversation.id === activeConversation.id)?.agentName ?? "未知 Agent"}
            statusLabel={statusLabel}
            onBack={(resetUserExpanded) => { onBack(); resetUserExpanded(); }}
            resetUserExpanded={() => onUserExpandedChange(false)}
            parseSenderMeta={parseSenderMeta}
            userExpanded={userExpanded}
            onUserExpandedChange={onUserExpandedChange}
            aiResponseScrollRef={aiResponseScrollRef}
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
            conversationMessageList={detailDisplayMode === "focus" ? renderFocusModeContent() : renderConversationModeContent()}
          />

          <ConversationComposer
            focused={composerFocused}
            value={composerValue}
            model={composerModel}
            thinking={composerThinking}
            sending={sending}
            attachments={composerAttachments}
            queuedMessages={activeQueuedMessages}
            modelOptions={ensureSelectedModelOption(modelOptions, composerModel)}
            thinkingOptions={activeConversation.thinkingOptions}
            modelsLoading={modelsLoading}
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
          <strong>还没有可显示的对话</strong>
          <p>先从左侧 Agent 树里展开一个会话，后续这里会支持直接新建对话。</p>
        </div>
      ) : null}
    </section>
  );
}
