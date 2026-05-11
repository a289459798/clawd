import { useRef } from "react";
import { Icon, IconNames } from "./Icon";
import { fileKindLabel, formatFileSize } from "../lib/fileDisplay";
import { shouldSubmitComposer } from "../lib/composerShortcut";
import type { SendShortcut } from "../types/settings";

type TranslateFn = (key: string) => string;
const tt = (t: TranslateFn, key: string, fallback: string) => {
  const value = t(key);
  return value === key ? fallback : value;
};

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
  model?: string;
  thinking?: string;
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
  t: TranslateFn;
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
  sendShortcut: SendShortcut;
  onFocusChange: (focused: boolean) => void;
  onValueChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onThinkingChange: (value: string) => void;
  onFilesSelected: (files: FileList | null) => void | Promise<void>;
  onRemoveAttachment: (attachmentId: string) => void;
  onRemoveQueuedMessage: (messageId: string) => void;
  onSend: () => void | Promise<void>;
  onAbort: () => void | Promise<void>;
  /** When true, show actions that clear session overrides (Gateway `sessions.patch` with null). */
  sessionOverrideResetEnabled?: boolean;
  onResetThinkingDefault?: () => void | Promise<void>;
  onResetFastDefault?: () => void | Promise<void>;
};

export function ConversationComposer({
  t,
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
  sendShortcut,
  onFocusChange,
  onValueChange,
  onModelChange,
  onThinkingChange,
  onFilesSelected,
  onRemoveAttachment,
  onRemoveQueuedMessage,
  onSend,
  onAbort,
  sessionOverrideResetEnabled = false,
  onResetThinkingDefault,
  onResetFastDefault,
}: ConversationComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resolvedThinkingOptions = thinkingOptions?.length ? thinkingOptions : FALLBACK_THINKING_OPTIONS;

  return (
    <div className={`conversation-composer ${focused ? "focused" : ""} ${transcriptScrollCompact ? "scroll-away" : ""}`}>
      <p className="composer-session-hint">
        {tt(t, "composer.sessionHintPrefix", "Model and thinking options only apply to")}<strong>{tt(t, "composer.currentSession", " current session")}</strong>{tt(t, "composer.sessionHintSuffix", "; configure default model in Models page.")}
        {sessionOverrideResetEnabled && onResetThinkingDefault && onResetFastDefault ? (
          <>
            {" "}
            <span className="composer-session-hint-actions">
              <button type="button" className="composer-inline-action" onClick={() => void onResetThinkingDefault()} title={tt(t, "composer.resetThinkingTitle", "Clear session thinking override, same as /think default")}>
                {tt(t, "composer.resetThinking", "Thinking default")}
              </button>
              <button type="button" className="composer-inline-action" onClick={() => void onResetFastDefault()} title={tt(t, "composer.resetFastTitle", "Clear session Fast override, same as /fast default")}>
                {tt(t, "composer.resetFast", "Fast default")}
              </button>
            </span>
          </>
        ) : null}
      </p>
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
          <div className="composer-queue" aria-label={tt(t, "composer.queueAria", "Queued messages")}>
            <div className="composer-queue-head">
              <span>{tt(t, "composer.queued", "Queued")}</span>
              <strong>{queuedMessages.length}</strong>
            </div>
            <div className="composer-queue-list">
              {queuedMessages.map((item, index) => (
                <div className="composer-queue-item" key={item.id}>
                  <span className="composer-queue-index">#{index + 1}</span>
                  <span className="composer-queue-text">
                    {item.text || (item.attachments.length > 0 ? `[${tt(t, "composer.attachment", "Attachment")}] ${item.attachments.map((attachment) => attachment.name).join(", ")}` : tt(t, "composer.emptyMessage", "Empty message"))}
                  </span>
                  <button type="button" onClick={() => onRemoveQueuedMessage(item.id)} title={tt(t, "composer.removeQueued", "Remove queued message")}>×</button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <textarea
          className="composer-input"
          placeholder={tt(t, "composer.inputPlaceholder", "Type a message...")}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (shouldSubmitComposer(sendShortcut, e)) {
              e.preventDefault();
              void onSend();
            }
          }}
          value={value}
        />
        {attachments.length > 0 ? (
          <div className="composer-attachments" aria-label={tt(t, "composer.attachmentsAria", "Selected attachments")}>
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
                <button type="button" onClick={() => onRemoveAttachment(attachment.id)} title={tt(t, "composer.removeAttachment", "Remove attachment")}>×</button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="composer-bar">
          <button className="composer-file-btn" type="button" title={tt(t, "composer.sendFile", "Send file")} onClick={() => fileInputRef.current?.click()}>
            <Icon name={IconNames.UPLOAD} size={16} />
          </button>
          <select className="composer-select" value={model} onChange={(e) => onModelChange(e.target.value)} title={tt(t, "models.title", "Model")} disabled={modelsLoading || modelOptions.length === 0}>
            {modelsLoading ? <option value={model}>{tt(t, "composer.loadingModels", "Loading models...")}</option> : null}
            {!modelsLoading && modelOptions.length === 0 ? <option value="">{tt(t, "composer.noModels", "No models available")}</option> : null}
            {!modelsLoading ? modelOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            )) : null}
          </select>
          <select className="composer-select" value={thinking} onChange={(e) => onThinkingChange(e.target.value)} title={tt(t, "composer.thinkingMode", "Thinking mode")}>
            {resolvedThinkingOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <div style={{ flex: 1 }} />
          {sending ? (
            <>
              <button className="composer-send-btn" type="button" title={tt(t, "composer.enqueue", "Queue message")} disabled={value.trim().length === 0 && attachments.length === 0} onClick={() => void onSend()}>
                <Icon name={IconNames.SEND} size={18} />
              </button>
              <button className="composer-stop-btn" type="button" title={tt(t, "common.stop", "Stop")} onClick={() => void onAbort()}>
                {tt(t, "common.stop", "Stop")}
              </button>
            </>
          ) : (
            <button className="composer-send-btn" type="button" title={tt(t, "composer.send", "Send")} disabled={value.trim().length === 0 && attachments.length === 0} onClick={() => void onSend()}>
              <Icon name={IconNames.SEND} size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
