import { useRef } from "react";

type ComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  previewUrl?: string;
};

type ModelOption = {
  value: string;
  label: string;
};

type ConversationComposerProps = {
  focused: boolean;
  value: string;
  model: string;
  thinking: string;
  sending: boolean;
  attachments: ComposerAttachment[];
  modelOptions: ModelOption[];
  onFocusChange: (focused: boolean) => void;
  onValueChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onThinkingChange: (value: string) => void;
  onFilesSelected: (files: FileList | null) => void | Promise<void>;
  onRemoveAttachment: (attachmentId: string) => void;
  onSend: () => void | Promise<void>;
  onAbort: () => void | Promise<void>;
};

export function ConversationComposer({
  focused,
  value,
  model,
  thinking,
  sending,
  attachments,
  modelOptions,
  onFocusChange,
  onValueChange,
  onModelChange,
  onThinkingChange,
  onFilesSelected,
  onRemoveAttachment,
  onSend,
  onAbort,
}: ConversationComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className={`conversation-composer ${focused ? "focused" : ""}`}>
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
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            void onFilesSelected(e.target.files);
            e.currentTarget.value = "";
          }}
        />
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
          <div className="composer-attachments">
            {attachments.map((attachment) => (
              <div className="composer-attachment-chip" key={attachment.id}>
                <span>{attachment.name}</span>
                <button type="button" onClick={() => onRemoveAttachment(attachment.id)}>×</button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="composer-bar">
          <button className="composer-file-btn" type="button" title="发送文件" onClick={() => fileInputRef.current?.click()}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M14 10V13C14 13.55 13.55 14 13 14H3C2.45 14 2 13.55 2 13V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M6 10V6C6 4.89 6.89 4 8 4C9.11 4 10 4.89 10 6V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M8 7V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <select className="composer-select" value={model} onChange={(e) => onModelChange(e.target.value)} title="模型">
            {modelOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select className="composer-select" value={thinking} onChange={(e) => onThinkingChange(e.target.value)} title="思考模式">
            <option value="" disabled>思考</option>
            <option value="off">Off</option>
            <option value="low">Low</option>
            <option value="high">High</option>
          </select>
          <div style={{ flex: 1 }} />
          {sending ? (
            <button className="composer-send-btn" type="button" title="停止" onClick={() => void onAbort()}>
              停止
            </button>
          ) : (
            <button className="composer-send-btn" type="button" title="发送" disabled={value.trim().length === 0 && attachments.length === 0} onClick={() => void onSend()}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M3 9H15M15 9L10.5 4.5M15 9L10.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
