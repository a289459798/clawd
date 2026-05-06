import { useEffect, useRef, type MutableRefObject } from "react";
import type { Agent } from "../types/app";
import type { MessagePart } from "../types/conversation";
import type { GatewayChatEvent } from "../types/gateway";
import { patchConversation } from "../lib/agentsSnapshot";
import { formatTokenCount } from "../lib/appFormatters";
import { conversationMatchesSessionKey, findConversationByGatewaySessionKey } from "../lib/conversationSelectors";
import { mapGatewayToolStreamToPart } from "../lib/toolStream";
import { extractTextFromGatewayMessage, extractUsageFromGatewayMessage, isInternalOpenClawMessage, mapGatewayContentToParts, mergeStreamingParts } from "../lib/gatewayMessages";

interface UseGatewayChatProps {
  enabled: boolean;
  activeConversationId: string | null;
  activeRunId: string | null;
  agentsRef: MutableRefObject<Agent[]>;
  onAgentsChange: (updater: (current: Agent[]) => Agent[]) => void;
  onActiveRunIdChange: (runId: string | null) => void;
  onSendingChange: (sending: boolean) => void;
  onGatewayError: (error: string | null) => void;
  onGatewayStatusTextChange: (text: string) => void;
  onGatewayConnectedChange: (connected: boolean) => void;
  refreshGatewayStatus: () => Promise<void>;
}

export function useGatewayChat({
  enabled,
  activeConversationId,
  activeRunId,
  agentsRef,
  onAgentsChange,
  onActiveRunIdChange,
  onSendingChange,
  onGatewayError,
  onGatewayStatusTextChange,
  onGatewayConnectedChange,
  refreshGatewayStatus,
}: UseGatewayChatProps) {
  const activeConversationIdRef = useRef(activeConversationId);
  const activeRunIdRef = useRef(activeRunId);
  const gatewayEventUnlistenRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    activeRunIdRef.current = activeRunId;
  }, [activeRunId]);

  const hasToolParts = (parts: MessagePart[]) => parts.some((part) => part.kind === "tool_call" || part.kind === "tool_result");
  const textFromParts = (parts: MessagePart[]) => parts.flatMap((part) => part.kind === "text" ? [part.text] : []).join("");
  const mergeStreamingText = (previousText: string, incomingText: string) => {
    if (!incomingText) return previousText;
    if (!previousText) return incomingText;
    if (incomingText.startsWith(previousText)) return incomingText;
    if (previousText.endsWith(incomingText)) return previousText;
    return `${previousText}${incomingText}`;
  };
  const summarizePreviewUsage = (messages: Array<{ input_tokens?: number; output_tokens?: number; cache_read_tokens?: number; cache_write_tokens?: number }>) => {
    const inputTokens = messages.reduce((sum, message) => sum + (message.input_tokens || 0), 0);
    const outputTokens = messages.reduce((sum, message) => sum + (message.output_tokens || 0), 0);
    const cacheReadTokens = messages.reduce((sum, message) => sum + (message.cache_read_tokens || 0), 0);
    const cacheWriteTokens = messages.reduce((sum, message) => sum + (message.cache_write_tokens || 0), 0);
    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    };
  };
  const findLastMessageIndex = <T,>(items: T[], predicate: (item: T, index: number) => boolean) => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (predicate(items[index], index)) return index;
    }
    return -1;
  };

  useEffect(() => {
    if (!enabled) return;

    let mounted = true;
    let dispose: (() => void) | undefined;

    void (async () => {
      await refreshGatewayStatus();
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen<GatewayChatEvent>("clawx://gateway-chat", (event) => {
          const chat = event.payload;
          if (!mounted || !chat?.sessionKey) return;

          const matchedConversation = findConversationByGatewaySessionKey(agentsRef.current, chat.sessionKey);
          const isCurrentConversation = Boolean(
            activeConversationIdRef.current
            && matchedConversation
            && matchedConversation.id === activeConversationIdRef.current,
          );
          const isCurrentRun = !chat.runId || !activeRunIdRef.current || chat.runId === activeRunIdRef.current;
          const eventTimestamp = chat.message?.timestamp ?? Date.now();
          const eventLastTime = new Date(eventTimestamp).toLocaleString("zh-CN");

          // Tool stream handling
          if (chat.stream === "tool") {
            const toolPart = mapGatewayToolStreamToPart(chat.data);
            if (!toolPart) return;
            const toolName = toolPart.kind === "tool_call" ? toolPart.tool : toolPart.tool ?? "tool";
            const toolRunId = chat.runId ?? activeRunIdRef.current ?? `tool-stream-${chat.sessionKey}`;
            
            onAgentsChange((current) => current.map((agent) => ({
              ...agent,
              conversations: agent.conversations.map((conversation) => {
                if (!conversationMatchesSessionKey(conversation, chat.sessionKey)) return conversation;
                return patchConversation(conversation, (currentConversation) => {
                  const nextMessages = [...(currentConversation.previewMessages ?? [])];
                  const toolKey = `${toolRunId}:${toolName}`;
                  const existingIndex = nextMessages.findIndex((message) =>
                    message.role?.toLowerCase() === "assistant"
                    && message.text === toolKey
                    && (message.parts ?? []).some((part) => part.kind === "tool_call" && part.tool === toolName),
                  );
                  if (existingIndex >= 0) {
                    const existing = nextMessages[existingIndex];
                    nextMessages[existingIndex] = {
                      ...existing,
                      parts: mergeStreamingParts(existing.parts ?? [], [toolPart], ""),
                      timestamp: eventTimestamp,
                    };
                  } else {
                    nextMessages.push({
                      role: "assistant",
                      text: toolKey,
                      parts: [toolPart],
                      timestamp: eventTimestamp,
                    });
                  }
                  return {
                    ...currentConversation,
                    lastRole: "assistant",
                    latestEventType: "tool_stream",
                    lastMessage: `🔧 ${toolName}`,
                    previewMessages: nextMessages,
                    updatedAt: eventTimestamp,
                    lastTime: eventLastTime,
                    runtime: {
                      ...currentConversation.runtime,
                      activeRunId: toolRunId,
                      activeStartedAt: currentConversation.runtime?.activeStartedAt ?? eventTimestamp,
                      lastEventAt: eventTimestamp,
                    },
                  };
                });
              }),
            })));
            
            if (isCurrentConversation && isCurrentRun) {
              onSendingChange(true);
            }
            return;
          }

          // Delta stream handling
          if (chat.state === "delta") {
            if (isInternalOpenClawMessage(chat.message)) return;
            const deltaText = extractTextFromGatewayMessage(chat.message);
            const deltaParts = mapGatewayContentToParts(chat.message);
            if (!deltaText && deltaParts.length === 0) return;
            
            onAgentsChange((current) => current.map((agent) => ({
              ...agent,
              conversations: agent.conversations.map((conversation) => {
                if (!conversationMatchesSessionKey(conversation, chat.sessionKey)) return conversation;
                return patchConversation(conversation, (currentConversation) => {
                  const nextMessages = [...(currentConversation.previewMessages ?? [])];
                  const effectiveRunId = chat.runId ?? currentConversation.runtime?.activeRunId ?? activeRunIdRef.current ?? `run-${eventTimestamp}`;
                  const streamingMarker = `__streaming__${effectiveRunId}__`;
                  const existingStreamingIndex = nextMessages.findIndex((message) =>
                    message.role?.toLowerCase() === "assistant" && message.text.startsWith(streamingMarker),
                  );
                  const lastIndex = existingStreamingIndex >= 0 ? existingStreamingIndex : nextMessages.length - 1;
                  const last = nextMessages[lastIndex];
                  
                  if (last?.role === "assistant" && last.text.startsWith(streamingMarker)) {
                    const usage = extractUsageFromGatewayMessage(chat.message);
                    const previousText = last.text.replace(streamingMarker, "");
                    const incomingText = textFromParts(deltaParts) || deltaText;
                    const nextText = mergeStreamingText(previousText, incomingText);
                    const nonTextParts = mergeStreamingParts(
                      (last.parts ?? []).filter((part) => part.kind !== "text"),
                      deltaParts.filter((part) => part.kind !== "text"),
                      "",
                    );
                    const mergedParts = nextText ? [{ kind: "text" as const, text: nextText }, ...nonTextParts] : nonTextParts;
                    nextMessages[lastIndex] = {
                      ...last,
                      text: `${streamingMarker}${nextText}`,
                      parts: mergedParts.length > 0 ? mergedParts : [{ kind: "text", text: nextText }],
                      model: chat.message?.model ?? last.model,
                      provider: chat.message?.provider ?? last.provider,
                      api: chat.message?.api ?? last.api,
                      timestamp: eventTimestamp,
                      input_tokens: usage.input_tokens ?? last.input_tokens,
                      output_tokens: usage.output_tokens ?? last.output_tokens,
                      cache_read_tokens: usage.cache_read_tokens ?? last.cache_read_tokens,
                      cache_write_tokens: usage.cache_write_tokens ?? last.cache_write_tokens,
                    };
                  } else if (deltaParts.length > 0 || deltaText) {
                    const incomingText = textFromParts(deltaParts) || deltaText;
                    const nonTextParts = deltaParts.filter((part) => part.kind !== "text");
                    const initialParts: MessagePart[] = incomingText ? [{ kind: "text", text: incomingText }, ...nonTextParts] : nonTextParts;
                    const initialText = initialParts
                      .filter((part) => part.kind === "text")
                      .map((part) => part.text)
                      .join("") || deltaText;
                    nextMessages.push({ 
                      role: "assistant", 
                      text: `${streamingMarker}${initialText}`, 
                      parts: initialParts, 
                      model: chat.message?.model, 
                      provider: chat.message?.provider, 
                      api: chat.message?.api, 
                      timestamp: eventTimestamp, 
                      ...extractUsageFromGatewayMessage(chat.message) 
                    });
                  }
                  
                  const latestPreview = nextMessages[nextMessages.length - 1];
                  const latestRenderedText = latestPreview?.text?.replace(streamingMarker, "") || deltaText;
                  return {
                    ...currentConversation,
                    lastRole: "assistant",
                    latestEventType: "assistant_stream",
                    lastMessage: latestRenderedText || currentConversation.lastMessage,
                    previewMessages: nextMessages,
                    updatedAt: eventTimestamp,
                    lastTime: eventLastTime,
                    runtime: {
                      ...currentConversation.runtime,
                      activeRunId: effectiveRunId,
                      activeStartedAt: currentConversation.runtime?.activeStartedAt ?? eventTimestamp,
                      lastEventAt: eventTimestamp,
                    },
                  };
                });
              }),
            })));
            
            if (isCurrentConversation && isCurrentRun) {
              onSendingChange(true);
            }
            return;
          }

          // Final/Aborted handling
          if (chat.state === "final" || chat.state === "aborted") {
            if (isInternalOpenClawMessage(chat.message)) {
              return;
            }
            const finalText = extractTextFromGatewayMessage(chat.message);
            const finalParts = mapGatewayContentToParts(chat.message);
            const terminalEventType = chat.state === "aborted" ? "aborted" : "turn_completed";
            
            if (isCurrentConversation && isCurrentRun) {
              onActiveRunIdChange(null);
              onSendingChange(false);
            }
            
            onAgentsChange((current) => current.map((agent) => ({
              ...agent,
              conversations: agent.conversations.map((conversation) => {
                if (!conversationMatchesSessionKey(conversation, chat.sessionKey)) return conversation;
                return patchConversation(conversation, (currentConversation) => {
                  const nextMessages = [...(currentConversation.previewMessages ?? [])];
                  const effectiveRunId = chat.runId ?? currentConversation.runtime?.activeRunId ?? activeRunIdRef.current ?? `run-${eventTimestamp}`;
                  const streamingMarker = `__streaming__${effectiveRunId}__`;
                  const existingStreamingIndex = nextMessages.findIndex((message) =>
                    message.role?.toLowerCase() === "assistant" && message.text.startsWith(streamingMarker),
                  );
                  const fallbackStreamingIndex = existingStreamingIndex >= 0
                    ? existingStreamingIndex
                    : findLastMessageIndex(nextMessages, (message) =>
                        message.role?.toLowerCase() === "assistant" && /^__streaming__(?:[^_]+__)?/.test(message.text),
                      );
                  const duplicateAssistantIndex = fallbackStreamingIndex >= 0
                    ? -1
                    : findLastMessageIndex(nextMessages, (message) => {
                        if (message.role?.toLowerCase() !== "assistant") return false;
                        const text = message.text.replace(/^__streaming__(?:[^_]+__)?/, "");
                        return Boolean(finalText) && (text === finalText || text.includes(finalText) || finalText.includes(text));
                      });
                  const lastIndex = fallbackStreamingIndex >= 0 ? fallbackStreamingIndex : duplicateAssistantIndex >= 0 ? duplicateAssistantIndex : nextMessages.length - 1;
                  const last = nextMessages[lastIndex];
                  
                  if (last?.role === "assistant" && (last.text.startsWith(streamingMarker) || /^__streaming__(?:[^_]+__)?/.test(last.text) || duplicateAssistantIndex >= 0)) {
                    const usage = extractUsageFromGatewayMessage(chat.message);
                    const fallbackText = last.text.replace(/^__streaming__(?:[^_]+__)?/, "");
                    const hasExistingToolMessages = nextMessages.some((message, index) => index !== lastIndex && hasToolParts(message.parts ?? []));
                    const finalTextOnlyParts = finalParts.filter((part) => part.kind === "text" || part.kind === "image");
                    const mergedFinalParts = finalParts.length > 0 && !hasExistingToolMessages
                      ? mergeStreamingParts([], finalParts, "")
                      : finalTextOnlyParts.length > 0
                        ? mergeStreamingParts([], finalTextOnlyParts, "")
                        : [{ kind: "text" as const, text: finalText || fallbackText }];
                    const renderedFinalText = mergedFinalParts
                      .flatMap((part) => part.kind === "text" ? [part.text] : [])
                      .join("") || finalText || fallbackText;
                    nextMessages[lastIndex] = {
                      ...last,
                      text: renderedFinalText,
                      parts: mergedFinalParts.length > 0 ? mergedFinalParts : [{ kind: "text", text: renderedFinalText }],
                      model: chat.message?.model ?? last.model ?? currentConversation.model,
                      provider: chat.message?.provider ?? last.provider,
                      api: chat.message?.api ?? last.api,
                      timestamp: eventTimestamp,
                      input_tokens: usage.input_tokens ?? last.input_tokens,
                      output_tokens: usage.output_tokens ?? last.output_tokens,
                      cache_read_tokens: usage.cache_read_tokens ?? last.cache_read_tokens,
                      cache_write_tokens: usage.cache_write_tokens ?? last.cache_write_tokens,
                    };
                  } else if (finalText || finalParts.length > 0) {
                    const hasExistingToolMessages = nextMessages.some((message) => hasToolParts(message.parts ?? []));
                    const finalTextOnlyParts = finalParts.filter((part) => part.kind === "text" || part.kind === "image");
                    const appendedParts: MessagePart[] = finalParts.length > 0 && !hasExistingToolMessages
                      ? mergeStreamingParts([], finalParts, "")
                      : finalTextOnlyParts.length > 0
                        ? mergeStreamingParts([], finalTextOnlyParts, "")
                        : [{ kind: "text", text: finalText }];
                    nextMessages.push({ 
                      role: "assistant", 
                      text: finalText, 
                      parts: appendedParts, 
                      model: chat.message?.model ?? currentConversation.model, 
                      provider: chat.message?.provider, 
                      api: chat.message?.api, 
                      timestamp: eventTimestamp, 
                      ...extractUsageFromGatewayMessage(chat.message) 
                    });
                  }
                  
                  const latestPreview = nextMessages[nextMessages.length - 1];
                  const latestRenderedText = latestPreview?.text || finalText;
                  const usageTotals = summarizePreviewUsage(nextMessages);
                  return {
                    ...currentConversation,
                    lastRole: "assistant",
                    latestEventType: terminalEventType,
                    lastMessage: latestRenderedText || currentConversation.lastMessage,
                    previewMessages: nextMessages,
                    inputTokens: usageTotals.inputTokens,
                    outputTokens: usageTotals.outputTokens,
                    cacheReadTokens: usageTotals.cacheReadTokens,
                    cacheWriteTokens: usageTotals.cacheWriteTokens,
                    totalTokens: usageTotals.totalTokens,
                    tokens: formatTokenCount(usageTotals.totalTokens),
                    updatedAt: eventTimestamp,
                    lastTime: eventLastTime,
                    runtime: {
                      ...currentConversation.runtime,
                      activeRunId: undefined,
                      activeStartedAt: undefined,
                      lastEventAt: eventTimestamp,
                      lastTerminalAt: eventTimestamp,
                      lastTerminalReason: chat.state === "aborted" ? "aborted" : "completed",
                    },
                  };
                });
              }),
            })));
            
            void refreshGatewayStatus();
            return;
          }

          // Error handling
          if (chat.state === "error") {
            if (isCurrentConversation && isCurrentRun) {
              onActiveRunIdChange(null);
              onSendingChange(false);
              onGatewayError(chat.errorMessage ?? "发送失败");
              onGatewayStatusTextChange(`Gateway 请求失败: ${chat.errorMessage ?? "发送失败"}`);
            }
            
            onAgentsChange((current) => current.map((agent) => ({
              ...agent,
              conversations: agent.conversations.map((conversation) => {
                if (!conversationMatchesSessionKey(conversation, chat.sessionKey)) return conversation;
                return patchConversation(conversation, (currentConversation) => ({
                  ...currentConversation,
                  latestEventType: "error",
                  runtime: {
                    ...currentConversation.runtime,
                    activeRunId: undefined,
                    activeStartedAt: undefined,
                    lastEventAt: Date.now(),
                    lastTerminalAt: Date.now(),
                    lastTerminalReason: "error",
                  },
                }));
              }),
            })));
          }
        });
        
        gatewayEventUnlistenRef.current = unlisten;
        dispose = () => {
          unlisten();
          gatewayEventUnlistenRef.current = null;
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onGatewayConnectedChange(false);
        onGatewayError(message);
        onGatewayStatusTextChange(`Gateway 事件订阅失败: ${message}`);
      }
    })();

    return () => {
      mounted = false;
      dispose?.();
    };
  }, [enabled, onAgentsChange, onActiveRunIdChange, onSendingChange, onGatewayError, onGatewayStatusTextChange, onGatewayConnectedChange, refreshGatewayStatus]);

  return {
    gatewayEventUnlistenRef,
  };
}
