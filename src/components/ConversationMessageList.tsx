import { useCallback, useEffect, useMemo, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import ReactMarkdown from "react-markdown";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
// import { Icon, IconNames } from "./Icon";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";
import { fileKindLabel, formatFileSize } from "../lib/fileDisplay";
import { isInternalOpenClawMessage, stripInboundWrapperText } from "../lib/gatewayMessages";
import { buildToolTimelineItems } from "../lib/toolStream";
import type { MessagePart, PreviewMessage } from "../types/conversation";
type TranslateFn = (key: string) => string;
const tt = (t: TranslateFn, key: string, fallback: string) => {
  const value = t(key);
  return value === key ? fallback : value;
};

const INITIAL_CONVERSATION_ROW_COUNT = 120;
const CONVERSATION_ROW_BATCH_SIZE = 80;

SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("sh", bash);
SyntaxHighlighter.registerLanguage("shell", bash);
SyntaxHighlighter.registerLanguage("css", css);
SyntaxHighlighter.registerLanguage("diff", diff);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("js", javascript);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("jsx", jsx);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("md", markdown);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("py", python);
SyntaxHighlighter.registerLanguage("rust", rust);
SyntaxHighlighter.registerLanguage("rs", rust);
SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("ts", typescript);

function CodeBlock({ code, language, t }: { code: string; language?: string; t: TranslateFn }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [code]);

  return (
    <div className="code-block-shell">
      <div className="code-block-toolbar">
        <span className="code-block-language">{language || "text"}</span>
        <button className="code-block-copy-button" type="button" onClick={handleCopy}>
          {copied ? tt(t, "common.copied", "Copied") : tt(t, "common.copy", "Copy")}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || "text"}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: "12px 14px",
          background: "#0c0f13",
          fontSize: "0.78rem",
          lineHeight: 1.65,
        }}
        codeTagProps={{
          style: {
            fontFamily: "'SF Mono', 'Fira Code', ui-monospace, monospace",
          },
        }}
        wrapLongLines
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

function MarkdownBlock({ content, className, t }: { content: string; className?: string; t: TranslateFn }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { className, children, ...rest } = props;
            const value = String(children).replace(/\n$/, "");
            const match = /language-([\w-]+)/.exec(className ?? "");
            const language = match?.[1];
            const isBlock = Boolean(language) || value.includes("\n");
            if (!isBlock) {
              return <code className="inline-code" {...rest}>{children}</code>;
            }
            return <CodeBlock code={value} language={language} t={t} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function normalizeImageSrc(data: string, mimeType?: string) {
  if (data.startsWith("data:") || data.startsWith("http://") || data.startsWith("https://") || data.startsWith("/") || data.startsWith("file://")) {
    return data;
  }
  const mime = mimeType && mimeType.length > 0 ? mimeType : "image/png";
  return `data:${mime};base64,${data}`;
}

function formatMessageTime(timestamp?: number) {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MessageBubbleWithCopy({
  text,
  imageVariant,
  t,
}: {
  text: string;
  imageVariant: "user" | "assistant" | "tool";
  t: TranslateFn;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [text]);

  return (
    <div className={`message-bubble ${imageVariant}`}>
      <div className="message-bubble-content">
        {imageVariant !== "user" ? (
          <button
            className="message-copy-button"
            type="button"
            onClick={handleCopy}
            title={copied ? tt(t, "common.copied", "Copied") : tt(t, "common.copyContent", "Copy content")}
          >
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        ) : null}
        {text.includes("```") ? (
          <MarkdownBlock content={text} className="markdown-body" t={t} />
        ) : (
          <MarkdownBlock content={text} className="markdown-body" t={t} />
        )}
      </div>
    </div>
  );
}

function StructuredMessageContent({
  parts,
  conversationId,
  onOpenImage,
  imageVariant = "assistant",
  t,
}: {
  parts: MessagePart[];
  conversationId: string;
  onOpenImage: (src: string) => void;
  imageVariant?: "user" | "assistant" | "tool";
  t: TranslateFn;
}) {
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [openFileError, setOpenFileError] = useState<string | null>(null);
  const elements: React.ReactNode[] = [];
  let pendingToolParts: MessagePart[] = [];

  const flushToolTimeline = () => {
    if (pendingToolParts.length === 0) return;
    const toolList = buildToolTimelineItems(pendingToolParts);
    if (toolList.length === 0) {
      pendingToolParts = [];
      return;
    }
    const key = `${conversationId}-tools-${elements.length}`;
    const failedCount = toolList.filter((item) => item.status === "failed").length;
    const runningCount = toolList.filter((item) => item.status === "running").length;
    const statusLabel = failedCount > 0 ? `${failedCount} ${tt(t, "tool.failedItems", "failed")}` : runningCount > 0 ? `${runningCount} ${tt(t, "tool.runningItems", "running")}` : tt(t, "tool.completed", "Completed");
    elements.push(
      <div className="tool-call-box" key={key}>
        <button className="tool-call-summary" type="button" onClick={() => setToolsExpanded((v) => !v)}>
          <span className={`tool-call-status-dot ${failedCount > 0 ? "failed" : runningCount > 0 ? "running" : "completed"}`} aria-hidden="true" />
          <span className="tool-call-summary-label">{toolList.length} {tt(t, "tool.operations", "tool operations")}</span>
          <span className="tool-call-summary-items">{Array.from(new Set(toolList.map((item) => item.tool))).slice(0, 3).join(" · ")}</span>
          <span className={`tool-call-summary-status ${failedCount > 0 ? "failed" : runningCount > 0 ? "running" : "completed"}`}>{statusLabel}</span>
          <span className="tool-call-summary-toggle">{toolsExpanded ? tt(t, "common.collapse", "Collapse") : tt(t, "common.expand", "Expand")}</span>
        </button>
        {toolsExpanded ? (
          <ol className="tool-call-detail-list">
            {toolList.map((item, index) => (
              <li className={`tool-call-detail ${item.status}`} key={`${key}-detail-${index}`}>
                <div className="tool-call-detail-head">
                  <span className="tool-call-step-index">{index + 1}</span>
                  <span className="tool-call-detail-name">{item.tool}</span>
                  <span className={`tool-call-detail-status ${item.status}`}>
                    {item.status === "running" ? tt(t, "tool.running", "Running") : item.status === "failed" ? tt(t, "tool.failed", "Failed") : tt(t, "tool.done", "Done")}
                  </span>
                </div>
                {item.argSummary ? <div className="tool-call-plain-summary">{tt(t, "tool.input", "Input")}: {item.argSummary}</div> : null}
                {item.outputSummary ? <div className="tool-call-plain-summary">{tt(t, "tool.result", "Result")}: {item.outputSummary}</div> : null}
                {item.args || item.result ? (
                  <details className="tool-call-raw-details">
                    <summary>{tt(t, "tool.rawDetails", "Raw details")}</summary>
                    {item.args ? (
                      <>
                        <div className="tool-call-detail-caption">{tt(t, "tool.inputArgs", "Input args")}</div>
                        <pre className="tool-call-detail-args">{item.args}</pre>
                      </>
                    ) : null}
                    {item.result ? (
                      <>
                        <div className="tool-call-detail-caption">{tt(t, "tool.returnContent", "Return content")}</div>
                        <pre className="tool-call-detail-args">{item.result}</pre>
                      </>
                    ) : null}
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
      </div>,
    );
    pendingToolParts = [];
  };

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.kind === "tool_call" || part.kind === "tool_result") {
      pendingToolParts.push(part);
      continue;
    }
    flushToolTimeline();
    if (part.kind === "text") {
      if (!part.text?.trim()) continue;
      elements.push(<MessageBubbleWithCopy key={`${conversationId}-text-${i}`} text={part.text} imageVariant={imageVariant} t={t} />);
    } else if (part.kind === "image") {
      const src = normalizeImageSrc(part.data, part.mime_type);
      elements.push(
        <button className={`message-image-card ${imageVariant}`} key={`${conversationId}-image-${i}`} type="button" onClick={() => onOpenImage(src)}>
          <img className="message-image" src={src} alt={part.alt ?? tt(t, "conversation.imageContent", "Image content")} />
          <span className="message-image-badge">{imageVariant === "user" ? tt(t, "conversation.userImage", "User image") : tt(t, "conversation.image", "Image")}</span>
        </button>,
      );
    } else if (part.kind === "file") {
      elements.push(
        <button
          className={`message-file-card ${imageVariant} ${part.path ? "clickable" : ""}`}
          key={`${conversationId}-file-${i}`}
          type="button"
          disabled={!part.path}
          title={part.path ? `${tt(t, "common.open", "Open")} ${part.path}` : part.name}
          onClick={async () => {
            if (!part.path) return;
            try {
              setOpenFileError(null);
              await openPath(part.path);
            } catch (error) {
              setOpenFileError(error instanceof Error ? error.message : String(error));
            }
          }}
        >
          <span className="message-file-icon">{fileKindLabel(part.mime_type, part.name)}</span>
          <span className="message-file-name" title={part.name}>{part.name}</span>
          <span className="message-file-meta">{[part.mime_type, formatFileSize(part.size)].filter(Boolean).join(" · ")}</span>
        </button>,
      );
    } else if (part.kind === "rich") {
      const labelKey = part.type === "presentation"
        ? "conversation.presentationContent"
        : part.type === "button" || part.type === "buttons" || part.type === "control" || part.type === "interactive"
          ? "conversation.interactiveContent"
          : "conversation.structuredContent";
      const labelFallback = part.type === "presentation"
        ? "Presentation content"
        : part.type === "button" || part.type === "buttons" || part.type === "control" || part.type === "interactive"
          ? "Interactive content"
          : "Structured content";
      elements.push(
        <div className={`message-rich-card ${imageVariant}`} key={`${conversationId}-rich-${i}`}>
          <span className="message-rich-type">{tt(t, labelKey, labelFallback)}</span>
          {part.title ? <strong className="message-rich-title">{part.title}</strong> : null}
          {part.text ? <span className="message-rich-text">{part.text}</span> : null}
        </div>,
      );
    }
  }
  flushToolTimeline();

  return (
    <>
      {elements}
      {openFileError ? <div className="message-file-error">{tt(t, "conversation.openAttachmentFailed", "Failed to open attachment")}: {openFileError}</div> : null}
    </>
  );
}

function hasMessageMeta(message: PreviewMessage) {
  return Boolean(
    message.model
    || message.input_tokens
    || message.output_tokens
    || message.cache_read_tokens
    || message.cache_write_tokens,
  );
}

function MessageMeta({
  message,
  formatTokenCount,
  role,
  t,
}: {
  message: PreviewMessage;
  formatTokenCount: (value?: number) => string;
  role: "user" | "assistant";
  t: TranslateFn;
}) {
  if (role !== "assistant" || !hasMessageMeta(message)) return null;

  return (
    <div className="message-meta">
      <span className="message-meta-model">{message.model || tt(t, "models.notReturned", "Model not returned")}</span>
      <span className="message-meta-divider">·</span>
      <span className="message-meta-tokens">
        <span className="token-item">↑{formatTokenCount(message.output_tokens)}</span>
        <span className="token-item">↓{formatTokenCount(message.input_tokens)}</span>
        {message.cache_read_tokens ? <span className="token-item">R{formatTokenCount(message.cache_read_tokens)}</span> : null}
        {message.cache_write_tokens ? <span className="token-item">W{formatTokenCount(message.cache_write_tokens)}</span> : null}
      </span>
    </div>
  );
}

type ConversationMessageListBaseProps = {
  t: TranslateFn;
  messages: PreviewMessage[];
  conversationId: string;
  onOpenImage: (src: string) => void;
  formatTokenCount: (value?: number) => string;
};

type ConversationMessageListInternalProps = ConversationMessageListBaseProps & {
  mode: "focus" | "conversation";
};

function ConversationMessageListInternal({
  t,
  messages,
  conversationId,
  onOpenImage,
  formatTokenCount,
  mode,
}: ConversationMessageListInternalProps) {
  const showUserMessages = mode === "conversation";
  const [visibleRowCount, setVisibleRowCount] = useState(INITIAL_CONVERSATION_ROW_COUNT);

  useEffect(() => {
    setVisibleRowCount(INITIAL_CONVERSATION_ROW_COUNT);
  }, [conversationId, mode]);

  const rows = useMemo(() => {
    const cleanText = (value?: string) => stripInboundWrapperText((value ?? "").replace(/^__streaming__(?:[^_]+__)?/, "")).trim();
    const cleanParts = (parts: MessagePart[] = []) => parts
      .flatMap<MessagePart>((part) => {
        if (part.kind !== "text") return [part];
        const text = cleanText(part.text);
        return text ? [{ ...part, text }] : [];
      });
    const normalizedMessages = messages
      .filter((message) => {
        if (isInternalOpenClawMessage(message)) return false;
        const role = message.role?.toLowerCase();
        if (role === "user" && !showUserMessages) return false;
        const parts = cleanParts(message.parts ?? []);
        const hasVisiblePart = parts.some((part) => part.kind !== "text" || part.text?.trim());
        const text = cleanText(message.text).toLowerCase();
        if ((text.startsWith("tool_result:") || text.startsWith("toolresult:")) && !hasVisiblePart) return false;
        return hasVisiblePart || Boolean(text.trim());
      })
      .map((message) => ({
        ...message,
        displayRepeatCount: undefined,
        text: cleanText(message.text),
        parts: cleanParts(message.parts ?? []),
      }));
    const isTextOnlyBubble = (msg: PreviewMessage) => {
      const parts = msg.parts ?? [];
      if (parts.length === 0) return true;
      return parts.every((part) => part.kind === "text");
    };
    const compactText = (value: string) => value.replace(/\s+/g, " ").trim();
    const messageRichnessScore = (msg: PreviewMessage) => {
      const parts = msg.parts ?? [];
      const nonTextParts = parts.filter((part) => part.kind !== "text").length;
      const tokenFields = [msg.input_tokens, msg.output_tokens, msg.cache_read_tokens, msg.cache_write_tokens]
        .filter((value) => typeof value === "number" && value > 0).length;
      return nonTextParts * 10 + tokenFields * 3 + (msg.model ? 2 : 0) + parts.length;
    };
    const mergeDuplicateAssistantMessage = (previous: PreviewMessage, next: PreviewMessage) => {
      const preferred = messageRichnessScore(next) >= messageRichnessScore(previous) ? next : previous;
      const fallback = preferred === next ? previous : next;
      return {
        ...preferred,
        model: preferred.model ?? fallback.model,
        provider: preferred.provider ?? fallback.provider,
        api: preferred.api ?? fallback.api,
        input_tokens: preferred.input_tokens ?? fallback.input_tokens,
        output_tokens: preferred.output_tokens ?? fallback.output_tokens,
        cache_read_tokens: preferred.cache_read_tokens ?? fallback.cache_read_tokens,
        cache_write_tokens: preferred.cache_write_tokens ?? fallback.cache_write_tokens,
        timestamp: Math.max(preferred.timestamp ?? 0, fallback.timestamp ?? 0) || preferred.timestamp || fallback.timestamp,
        displayRepeatCount: undefined,
      };
    };
    const collapsedMessages = normalizedMessages.reduce<PreviewMessage[]>((acc, message) => {
      const previous = acc[acc.length - 1];
      const role = message.role?.toLowerCase();
      if (previous?.role?.toLowerCase() === "user" && role === "user") {
        const previousText = cleanText(previous.text);
        const nextText = cleanText(message.text);
        if (
          previousText && nextText && previousText === nextText
          && isTextOnlyBubble(previous) && isTextOnlyBubble(message)
        ) {
          const pick = message.timestamp && (!previous.timestamp || message.timestamp >= previous.timestamp) ? message : previous;
          acc[acc.length - 1] = {
            ...pick,
            displayRepeatCount: (previous.displayRepeatCount ?? 1) + 1,
          };
          return acc;
        }
      }
      if (previous?.role?.toLowerCase() === "assistant" && role === "assistant") {
        const previousText = cleanText(previous.text);
        const nextText = cleanText(message.text);
        const previousHasTools = (previous.parts ?? []).some((part) => part.kind === "tool_call");
        const nextHasTools = (message.parts ?? []).some((part) => part.kind === "tool_call");
        if (previousText && nextText && compactText(previousText) === compactText(nextText)) {
          acc[acc.length - 1] = mergeDuplicateAssistantMessage(previous, message);
          return acc;
        }
        if (!previousHasTools && !nextHasTools && previousText && nextText) {
          if (previousText === nextText) {
            acc[acc.length - 1] = {
              ...message,
              displayRepeatCount: (previous.displayRepeatCount ?? 1) + 1,
            };
            return acc;
          }
          if (nextText.includes(previousText)) {
            acc[acc.length - 1] = message;
            return acc;
          }
          if (previousText.includes(nextText)) {
            return acc;
          }
        }
      }
      acc.push(message);
      return acc;
    }, []);

    const rows: Array<
      | { kind: "message"; message: PreviewMessage; index: number }
      | { kind: "tool_group"; items: Array<{ message: PreviewMessage; index: number }> }
    > = [];

    let pendingToolMessages: Array<{ message: PreviewMessage; index: number }> = [];
    const isToolOnlyMessage = (message: PreviewMessage) => {
      const parts = message.parts ?? [];
      const hasToolParts = parts.some((part) => part.kind === "tool_call" || part.kind === "tool_result");
      const hasNonToolContent = parts.some((part) => part.kind !== "tool_call" && part.kind !== "tool_result" && (part.kind !== "text" || part.text?.trim()));
      return hasToolParts && !hasNonToolContent;
    };
    const flushToolMessages = () => {
      if (pendingToolMessages.length > 0) {
        rows.push({ kind: "tool_group", items: pendingToolMessages });
        pendingToolMessages = [];
      }
    };

    collapsedMessages.forEach((message, index) => {
      if (isToolOnlyMessage(message)) {
        pendingToolMessages.push({ message, index });
        return;
      }
      flushToolMessages();
      rows.push({ kind: "message", message, index });
    });
    flushToolMessages();

    return rows;
  }, [messages, showUserMessages]);

  const shouldWindowRows = mode === "conversation" && rows.length > INITIAL_CONVERSATION_ROW_COUNT;
  const hiddenEarlierRowCount = shouldWindowRows ? Math.max(0, rows.length - visibleRowCount) : 0;
  const displayedRows = shouldWindowRows ? rows.slice(Math.max(0, rows.length - visibleRowCount)) : rows;

  return (
    <div className={`conversation-message-list ${mode}-mode`}>
      {hiddenEarlierRowCount > 0 ? (
        <button
          className="conversation-load-earlier"
          type="button"
          onClick={() => setVisibleRowCount((current) => current + CONVERSATION_ROW_BATCH_SIZE)}
        >
          {tt(t, "conversation.loadEarlier", "Load earlier messages")}
          <span>{tt(t, "conversation.hiddenCountPrefix", "Still")} {hiddenEarlierRowCount} {tt(t, "conversation.hiddenCountSuffix", "hidden")}</span>
        </button>
      ) : null}
      {displayedRows.map((row) => {
        if (row.kind === "tool_group") {
          const mergedParts = row.items.flatMap((item) => item.message.parts ?? []);
          const groupKey = row.items.map((item) => item.index).join("-");
          return (
            <div className="message-stack assistant tool-stack" key={`${conversationId}-tool-group-${groupKey}`}>
              <StructuredMessageContent
                parts={mergedParts}
                conversationId={`${conversationId}-tool-group-${groupKey}`}
                onOpenImage={onOpenImage}
                imageVariant="tool"
                t={t}
              />
            </div>
          );
        }

        const { message } = row;
        const messageRole = message.role?.toLowerCase() === "user" ? "user" : "assistant";
        const parts = message.parts?.length ? message.parts : [{ kind: "text", text: message.text } as MessagePart];
        const messageTime = mode === "conversation" ? formatMessageTime(message.timestamp) : "";
        return (
          <div className={`message-stack ${messageRole}`} key={`${conversationId}-message-${row.index}`}>
            {message.displayRepeatCount && message.displayRepeatCount > 1 ? (
              <div className="message-repeat-badge" title={`${tt(t, "conversation.repeatMergedPrefix", "Merged")} ${message.displayRepeatCount} ${tt(t, "conversation.repeatMergedSuffix", "repeated messages")}`}>
                ×{message.displayRepeatCount}
              </div>
            ) : null}
            <StructuredMessageContent
              parts={parts}
              conversationId={`${conversationId}-${row.index}`}
              onOpenImage={onOpenImage}
              imageVariant={messageRole}
              t={t}
            />
            <MessageMeta message={message} formatTokenCount={formatTokenCount} role={messageRole} t={t} />
            {messageTime ? (
              <time className="message-time-badge conversation-message-time" dateTime={new Date(message.timestamp as number).toISOString()}>
                {messageTime}
              </time>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function FocusAssistantMessageList(props: ConversationMessageListBaseProps) {
  return <ConversationMessageListInternal {...props} mode="focus" />;
}

export function FullConversationMessageList(props: ConversationMessageListBaseProps) {
  return <ConversationMessageListInternal {...props} mode="conversation" />;
}
