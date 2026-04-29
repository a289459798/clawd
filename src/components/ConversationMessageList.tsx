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
import { isInternalOpenClawMessage } from "../lib/gatewayMessages";
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

export function ConversationMessageList({
  messages,
  conversationId,
  onOpenImage,
  formatTokenCount,
  showUserMessages = false,
}: {
  messages: PreviewMessage[];
  conversationId: string;
  onOpenImage: (src: string) => void;
  formatTokenCount: (value?: number) => string;
  showUserMessages?: boolean;
}) {
  const { rows, lastAssistantMessage } = useMemo(() => {
    const normalizedMessages = messages
      .filter((message) => {
        if (isInternalOpenClawMessage(message)) return false;
        const role = message.role?.toLowerCase();
        if (role === "user" && !showUserMessages) return false;
        const parts = message.parts ?? [];
        const hasVisiblePart = parts.some((part) => part.kind !== "tool_result" && (part.kind !== "text" || part.text?.trim()));
        const text = (message.text ?? "").trim().toLowerCase();
        if (role === "toolresult" || role === "tool_result") return false;
        if (text.startsWith("tool_result:") || text.startsWith("toolresult:")) return false;
        return hasVisiblePart || Boolean(text.trim());
      })
      .map((message) => ({
        ...message,
        parts: (message.parts ?? []).filter((part) => part.kind !== "tool_result"),
      }));

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

    normalizedMessages.forEach((message, index) => {
      if (isToolOnlyMessage(message)) {
        pendingToolMessages.push({ message, index });
        return;
      }
      flushToolMessages();
      rows.push({ kind: "message", message, index });
    });
    flushToolMessages();

    const lastAssistantMessage = [...normalizedMessages]
      .reverse()
      .find((m) => {
        const role = m.role?.toLowerCase();
        if (role !== "assistant") return false;
        const parts = m.parts ?? [];
        const hasTextContent = parts.some((p) => p.kind === "text" && p.text?.trim());
        const hasImageContent = parts.some((p) => p.kind === "image");
        return hasTextContent || hasImageContent || (!parts.length && m.text?.trim());
      });

    return { rows, lastAssistantMessage };
  }, [messages, showUserMessages]);

  return (
    <>
      {rows.map((row, index) => {
        if (row.kind === "tool_group") {
          const mergedParts = row.items.flatMap((item) => item.message.parts ?? []);
          return (
            <div className="message-stack tool-stack" key={`${conversationId}-tool-group-${index}`}>
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
        const parts = message.parts?.length ? message.parts : [{ kind: "text", text: message.text } as MessagePart];
        return (
          <div className="message-stack" key={`${conversationId}-message-${index}`}>
            <StructuredMessageContent
              parts={parts}
              conversationId={`${conversationId}-${index}`}
              onOpenImage={onOpenImage}
              imageVariant={message.role?.toLowerCase() === "user" ? "user" : "assistant"}
            />
          </div>
        );
      })}

      {lastAssistantMessage?.model ? (
        <div className="conversation-model-footer" key={`${conversationId}-model-footer`}>
          <span className="conversation-model-name">{lastAssistantMessage.model}</span>
          <span className="conversation-model-divider">·</span>
          <span className="conversation-model-tokens">
            <span className="token-item">↑{formatTokenCount(lastAssistantMessage.output_tokens)}</span>
            <span className="token-item">↓{formatTokenCount(lastAssistantMessage.input_tokens)}</span>
            <span className="token-item">R{formatTokenCount(lastAssistantMessage.cache_read_tokens)}</span>
          </span>
        </div>
      ) : null}
    </>
  );
}
