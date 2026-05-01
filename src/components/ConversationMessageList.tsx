import { useCallback, useMemo, useState } from "react";
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
import { isInternalOpenClawMessage, stripInboundWrapperText } from "../lib/gatewayMessages";
import type { MessagePart, PreviewMessage } from "../types/conversation";

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

function CodeBlock({ code, language }: { code: string; language?: string }) {
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
          {copied ? "已复制" : "复制"}
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

function MarkdownBlock({ content, className }: { content: string; className?: string }) {
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
            return <CodeBlock code={value} language={language} />;
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

function MessageBubbleWithCopy({
  text,
  imageVariant,
}: {
  text: string;
  imageVariant: "user" | "assistant" | "tool";
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
            title={copied ? "已复制" : "复制内容"}
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
          <MarkdownBlock content={text} className="markdown-body" />
        ) : (
          <MarkdownBlock content={text} className="markdown-body" />
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
}: {
  parts: MessagePart[];
  conversationId: string;
  onOpenImage: (src: string) => void;
  imageVariant?: "user" | "assistant" | "tool";
}) {
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const elements: React.ReactNode[] = [];
  let pendingToolCalls: Array<{ tool: string; args?: string }> = [];

  const flushToolCalls = () => {
    if (pendingToolCalls.length === 0) return;
    const toolList = [...pendingToolCalls];
    const key = `${conversationId}-tools-${elements.length}`;
    elements.push(
      <div className="tool-call-box" key={key}>
        <button className="tool-call-summary" type="button" onClick={() => setToolsExpanded((v) => !v)}>
          <span className="tool-call-summary-label">已执行 {toolList.length} 项操作</span>
          <span className="tool-call-summary-items">{Array.from(new Set(toolList.map((item) => item.tool))).slice(0, 3).join(" · ")}</span>
          <span className="tool-call-summary-toggle">{toolsExpanded ? "收起" : "展开"}</span>
        </button>
        {toolsExpanded ? (
          <div className="tool-call-detail-list">
            {toolList.map((item, index) => (
              <div className="tool-call-detail" key={`${key}-detail-${index}`}>
                <div className="tool-call-detail-name">{item.tool}</div>
                {item.args ? <pre className="tool-call-detail-args">{item.args}</pre> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>,
    );
    pendingToolCalls = [];
  };

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.kind === "tool_call") {
      pendingToolCalls.push({ tool: part.tool, args: part.args });
      continue;
    }
    if (part.kind === "tool_result") {
      continue;
    }
    flushToolCalls();
    if (part.kind === "text") {
      if (!part.text?.trim()) continue;
      elements.push(<MessageBubbleWithCopy key={`${conversationId}-text-${i}`} text={part.text} imageVariant={imageVariant} />);
    } else if (part.kind === "image") {
      const src = normalizeImageSrc(part.data, part.mime_type);
      elements.push(
        <button className={`message-image-card ${imageVariant}`} key={`${conversationId}-image-${i}`} type="button" onClick={() => onOpenImage(src)}>
          <img className="message-image" src={src} alt={part.alt ?? "图片内容"} />
          <span className="message-image-badge">{imageVariant === "user" ? "用户图片" : "图片"}</span>
        </button>,
      );
    }
  }
  flushToolCalls();

  return <>{elements}</>;
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
}: {
  message: PreviewMessage;
  formatTokenCount: (value?: number) => string;
  role: "user" | "assistant";
}) {
  if (role !== "assistant" || !hasMessageMeta(message)) return null;

  return (
    <div className="message-meta">
      <span className="message-meta-model">{message.model || "模型未返回"}</span>
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
  messages: PreviewMessage[];
  conversationId: string;
  onOpenImage: (src: string) => void;
  formatTokenCount: (value?: number) => string;
};

type ConversationMessageListInternalProps = ConversationMessageListBaseProps & {
  mode: "focus" | "conversation";
};

function ConversationMessageListInternal({
  messages,
  conversationId,
  onOpenImage,
  formatTokenCount,
  mode,
}: ConversationMessageListInternalProps) {
  const showUserMessages = mode === "conversation";
  const rows = useMemo(() => {
    const cleanText = (value?: string) => stripInboundWrapperText((value ?? "").replace(/^__streaming__(?:[^_]+__)?/, "")).trim();
    const collapseRepeatedText = (value: string) => {
      const text = value.trim();
      if (!text) return "";
      for (let size = 1; size <= Math.floor(text.length / 2); size += 1) {
        if (text.length % size !== 0) continue;
        const unit = text.slice(0, size);
        if (unit.repeat(text.length / size) === text) return unit.trim();
      }
      return text;
    };
    const cleanParts = (parts: MessagePart[] = []) => parts
      .filter((part) => part.kind !== "tool_result")
      .flatMap<MessagePart>((part) => {
        if (part.kind !== "text") return [part];
        const text = collapseRepeatedText(cleanText(part.text));
        return text ? [{ ...part, text }] : [];
      });
    const normalizedMessages = messages
      .filter((message) => {
        if (isInternalOpenClawMessage(message)) return false;
        const role = message.role?.toLowerCase();
        if (role === "user" && !showUserMessages) return false;
        const parts = cleanParts(message.parts ?? []);
        const hasVisiblePart = parts.some((part) => part.kind !== "tool_result" && (part.kind !== "text" || part.text?.trim()));
        const text = cleanText(message.text).toLowerCase();
        if (role === "toolresult" || role === "tool_result") return false;
        if (text.startsWith("tool_result:") || text.startsWith("toolresult:")) return false;
        return hasVisiblePart || Boolean(text.trim());
      })
      .map((message) => ({
        ...message,
        text: collapseRepeatedText(cleanText(message.text)),
        parts: cleanParts(message.parts ?? []),
      }));
    const collapsedMessages = normalizedMessages.reduce<PreviewMessage[]>((acc, message) => {
      const previous = acc[acc.length - 1];
      const role = message.role?.toLowerCase();
      if (previous?.role?.toLowerCase() === "user" && role === "user") {
        const previousText = cleanText(previous.text);
        const nextText = cleanText(message.text);
        if (previousText && nextText && previousText === nextText) {
          acc[acc.length - 1] = message.timestamp && (!previous.timestamp || message.timestamp >= previous.timestamp) ? message : previous;
          return acc;
        }
      }
      if (previous?.role?.toLowerCase() === "assistant" && role === "assistant") {
        const previousText = cleanText(previous.text);
        const nextText = cleanText(message.text);
        const previousHasTools = (previous.parts ?? []).some((part) => part.kind === "tool_call");
        const nextHasTools = (message.parts ?? []).some((part) => part.kind === "tool_call");
        if (!previousHasTools && !nextHasTools && previousText && nextText) {
          if (nextText === previousText || nextText.includes(previousText)) {
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
      const hasToolCalls = parts.some((part) => part.kind === "tool_call");
      const hasTextContent = parts.some((part) => part.kind === "text" && part.text?.trim());
      return hasToolCalls && !hasTextContent;
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

  return (
    <div className={`conversation-message-list ${mode}-mode`}>
      {rows.map((row, index) => {
        if (row.kind === "tool_group") {
          const mergedParts = row.items.flatMap((item) => item.message.parts ?? []);
          return (
            <div className="message-stack assistant tool-stack" key={`${conversationId}-tool-group-${index}`}>
              <StructuredMessageContent
                parts={mergedParts}
                conversationId={`${conversationId}-tool-group-${index}`}
                onOpenImage={onOpenImage}
                imageVariant="tool"
              />
            </div>
          );
        }

        const { message } = row;
        const messageRole = message.role?.toLowerCase() === "user" ? "user" : "assistant";
        const parts = message.parts?.length ? message.parts : [{ kind: "text", text: message.text } as MessagePart];
        return (
          <div className={`message-stack ${messageRole}`} key={`${conversationId}-message-${index}`}>
            <StructuredMessageContent
              parts={parts}
              conversationId={`${conversationId}-${index}`}
              onOpenImage={onOpenImage}
              imageVariant={messageRole}
            />
            <MessageMeta message={message} formatTokenCount={formatTokenCount} role={messageRole} />
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
