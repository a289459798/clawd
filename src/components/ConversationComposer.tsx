import { useRef } from "react";
import { Icon, IconNames } from "./Icon";
import { fileKindLabel, formatFileSize } from "../lib/fileDisplay";

type ComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  previewUrl?: string;
  size?: number;
  path?: string;
};

type QueuedComposerMessage = {
  id: string;
  text: string;
  attachments: ComposerAttachment[];
};

type ModelOption = {
  value: string;
  label: string;
};

const FALLBACK_THINKING_OPTIONS = [
  { value: "off", label: "off" },
  { value: "low", label: "low" },
  { value: "high", label: "high" },
];

type ConversationComposerProps = {
  transcriptScrollCompact?: boolean;
  focused: boolean;
  value: string;
  model: string;
  thinking: string;
  sending: boolean;
  attachments: ComposerAttachment[];
  queuedMessages: QueuedComposerMessage[];
  modelOptions: ModelOption[];
  thinkingOptions?: ModelOption[];
  modelsLoading?: boolean;
  onFocusChange: (focused: boolean) => void;
  onValueChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onThinkingChange: (value: string) => void;
  onFilesSelected: (files: FileList | null) => void | Promise<void>;
  onRemoveAttachment: (attachmentId: string) => void;
  onRemoveQueuedMessage: (messageId: string) => void;
  onSend: () => void | Promise<void>;
  onAbort: () => void | Promise<void>;
};

export function ConversationComposer({
  transcriptScrollCompact = false,
  focused,
  value,
  model,
  thinking,
  sending,
  attachments,
  queuedMessages,
  modelOptions,
  thinkingOptions,
  modelsLoading = false,
  onFocusChange,
  onValueChange,
  onModelChange,
  onThinkingChange,
  onFilesSelected,
  onRemoveAttachment,
  onRemoveQueuedMessage,
  onSend,
  onAbort,
}: ConversationComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resolvedThinkingOptions = thinkingOptions?.length ? thinkingOptions : FALLBACK_THINKING_OPTIONS;

  return (
    <div className={`conversation-composer ${focused ? "focused" : ""} ${transcriptScrollCompact ? "scroll-away" : ""}`}>
      <p className="composer-session-hint">模型与思考选项仅作用于<strong>当前会话</strong>；默认模型请在「模型」页配置。</p>
      <div
        className="composer-input-wrap"
        tabIndex={-1}
        onFocus={() => onFocusChange(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            onFocusChange(false);
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            void onFilesSelected(e.target.files);
            e.currentTarget.value = "";
          }}
        />
        {queuedMessages.length > 0 ? (
          <div className="composer-queue" aria-label="待发送消息列表">
            <div className="composer-queue-head">
              <span>待发送</span>
              <strong>{queuedMessages.length}</strong>
            </div>
            <div className="composer-queue-list">
              {queuedMessages.map((item, index) => (
                <div className="composer-queue-item" key={item.id}>
                  <span className="composer-queue-index">#{index + 1}</span>
                  <span className="composer-queue-text">
                    {item.text || (item.attachments.length > 0 ? `[附件] ${item.attachments.map((attachment) => attachment.name).join(", ")}` : "空消息")}
                  </span>
                  <button type="button" onClick={() => onRemoveQueuedMessage(item.id)} title="删除待发送消息">×</button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <textarea
          className="composer-input"
          placeholder="输入消息…"
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSend();
            }
          }}
          value={value}
        />
        {attachments.length > 0 ? (
          <div className="composer-attachments" aria-label="已选择附件">
            {attachments.map((attachment) => (
              <div className="composer-attachment-card" key={attachment.id}>
                {attachment.previewUrl ? (
                  <img src={attachment.previewUrl} alt={attachment.name} />
                ) : (
                  <div className="composer-file-preview" aria-hidden="true">
                    <span>{fileKindLabel(attachment.mimeType, attachment.name)}</span>
                  </div>
                )}
                <div className="composer-attachment-meta">
                  <span title={attachment.name}>{attachment.name}</span>
                  {attachment.size ? <small>{formatFileSize(attachment.size)}</small> : null}
                </div>
                <button type="button" onClick={() => onRemoveAttachment(attachment.id)} title="移除附件">×</button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="composer-bar">
          <button className="composer-file-btn" type="button" title="发送文件" onClick={() => fileInputRef.current?.click()}>
            <Icon name={IconNames.UPLOAD} size={16} color="#ffffff" style={{ fill: '#ffffff', stroke: '#ffffff' }} />
          </button>
          <select className="composer-select" value={model} onChange={(e) => onModelChange(e.target.value)} title="模型" disabled={modelsLoading || modelOptions.length === 0}>
            {modelsLoading ? <option value={model}>加载模型…</option> : null}
            {!modelsLoading && modelOptions.length === 0 ? <option value="">无可用模型</option> : null}
            {!modelsLoading ? modelOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            )) : null}
          </select>
          <select className="composer-select" value={thinking} onChange={(e) => onThinkingChange(e.target.value)} title="思考模式">
            {resolvedThinkingOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <div style={{ flex: 1 }} />
          {sending ? (
            <>
              <button className="composer-send-btn" type="button" title="加入待发送" disabled={value.trim().length === 0 && attachments.length === 0} onClick={() => void onSend()}>
                <Icon name={IconNames.SEND} size={18} />
              </button>
              <button className="composer-stop-btn" type="button" title="停止" onClick={() => void onAbort()}>
                停止
              </button>
            </>
          ) : (
            <button className="composer-send-btn" type="button" title="发送" disabled={value.trim().length === 0 && attachments.length === 0} onClick={() => void onSend()}>
              <Icon name={IconNames.SEND} size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
