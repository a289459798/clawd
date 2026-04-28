import type { RefObject } from "react";
import { ConversationComposer } from "./ConversationComposer";
import { ConversationDetail } from "./ConversationDetail";
import { ConversationList } from "./ConversationList";
import { ConversationMessageList } from "./ConversationMessageList";
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
            onJumpToBottom={() => {
              const container = aiResponseScrollRef.current;
              if (!container) return;
              container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
              shouldStickToBottomRef.current = true;
              onJumpToBottomHidden();
            }}
            onUpdateTitle={onUpdateTitle}
            conversationMessageList={(() => {
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
                    <ConversationMessageList
                      messages={detailState.normalizedMessages}
                      conversationId={activeConversation.id}
                      onOpenImage={onOpenImage}
                      formatTokenCount={formatTokenCount}
                    />
                  ) : null}
                  {shouldShowInProgress && (
                    <div className="thinking-indicator-fixed" role="status" aria-live="polite">
                      <div className="thinking-dots" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
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
        <ConversationList
          conversations={filteredVisibleConversations}
          statusLabel={statusLabel}
          onOpen={onOpenConversation}
          onHide={onHideConversation}
        />
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
