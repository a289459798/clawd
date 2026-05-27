import { useEffect, useRef, type MutableRefObject } from "react";
import type { Agent } from "../types/app";
import type { MessagePart } from "../types/conversation";
import type { GatewayChatEvent } from "../types/gateway";
import { patchConversation } from "../lib/agentsSnapshot";
import { formatTokenCount } from "../lib/appFormatters";
import { conversationMatchesSessionKey, findConversationByGatewaySessionKey } from "../lib/conversationSelectors";
import { mapGatewayToolStreamToPart } from "../lib/toolStream";
import { extractGatewayDeltaFrame, extractTextFromGatewayMessage, extractUsageFromGatewayMessage, isInternalOpenClawMessage, mapGatewayContentToParts, mergeStreamingParts } from "../lib/gatewayMessages";

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
  onTerminalChatEvent?: () => void;
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
  onTerminalChatEvent,
}: UseGatewayChatProps) {
  const activeConversationIdRef = useRef(activeConversationId);
  const activeRunIdRef = useRef(activeRunId);
  const gatewayEventUnlistenRef = useRef<null | (() => void)>(null);
  const terminalRunKeysRef = useRef<Set<string>>(new Set());
  const pendingTextDeltaRef = useRef<Map<string, {
    sessionKey: string;
    runId?: string | null;
    text: string;
    timestamp: number;
    lastTime: string;
    message?: GatewayChatEvent["message"];
    isHeartbeat?: boolean;
    currentConversation: boolean;
    currentRun: boolean;
  }>>(new Map());
  const pendingTextDeltaTimerRef = useRef<number | null>(null);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    activeRunIdRef.current = activeRunId;
  }, [activeRunId]);

  const hasToolParts = (parts: MessagePart[]) => parts.some((part) => part.kind === "tool_call" || part.kind === "tool_result");
  const isToolOnlyAssistantMessage = (message: { role?: string; parts?: MessagePart[] }) => {
    const parts = message.parts ?? [];
    return message.role?.toLowerCase() === "assistant"
      && parts.length > 0
      && parts.every((part) => part.kind === "tool_call" || part.kind === "tool_result");
  };
  const isTextOnlyAssistantMessage = (message: { role?: string; text?: string; parts?: MessagePart[] }) => {
    if (message.role?.toLowerCase() !== "assistant") return false;
    const text = (message.text ?? "").replace(/^__streaming__(?:[^_]+__)?/, "").trim();
    const parts = message.parts ?? [];
    return Boolean(text) && (parts.length === 0 || parts.every((part) => part.kind === "text"));
  };
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
  const runKey = (sessionKey?: string, runId?: string | null) => sessionKey && runId ? `${sessionKey}:${runId}` : null;
  const rememberTerminalRun = (sessionKey?: string, runId?: string | null) => {
    const key = runKey(sessionKey, runId);
    if (!key) return;
    terminalRunKeysRef.current.add(key);
    if (terminalRunKeysRef.current.size > 100) {
      const [oldest] = terminalRunKeysRef.current;
      if (oldest) terminalRunKeysRef.current.delete(oldest);
    }
  };
  const isTerminalRunEvent = (sessionKey?: string, runId?: string | null) => {
    const key = runKey(sessionKey, runId);
    return Boolean(key && terminalRunKeysRef.current.has(key));
  };
  const applyBufferedTextDeltas = () => {
    if (pendingTextDeltaTimerRef.current !== null) {
      window.clearTimeout(pendingTextDeltaTimerRef.current);
      pendingTextDeltaTimerRef.current = null;
    }
    const buffered = Array.from(pendingTextDeltaRef.current.values());
    pendingTextDeltaRef.current.clear();
    if (buffered.length === 0) return;

    onAgentsChange((current) => current.map((agent) => ({
      ...agent,
      conversations: agent.conversations.map((conversation) => {
        const item = buffered.find((delta) => conversationMatchesSessionKey(conversation, delta.sessionKey));
        if (!item) return conversation;
        return patchConversation(conversation, (currentConversation) => {
          const nextMessages = [...(currentConversation.previewMessages ?? [])];
          const effectiveRunId = item.runId ?? currentConversation.runtime?.activeRunId ?? activeRunIdRef.current ?? `run-${item.timestamp}`;
          const streamingMarker = `__streaming__${effectiveRunId}__`;
          const existingStreamingIndex = nextMessages.findIndex((message) =>
            message.role?.toLowerCase() === "assistant" && message.text.startsWith(streamingMarker),
          );
          const fallbackStreamingIndex = existingStreamingIndex >= 0
            ? existingStreamingIndex
            : findLastMessageIndex(nextMessages, (message) =>
                message.role?.toLowerCase() === "assistant" && /^__streaming__(?:[^_]+__)?/.test(message.text),
              );
          const lastIndex = fallbackStreamingIndex >= 0 ? fallbackStreamingIndex : nextMessages.length - 1;
          const last = nextMessages[lastIndex];
          const usage = extractUsageFromGatewayMessage(item.message);

          if (last?.role === "assistant" && /^__streaming__(?:[^_]+__)?/.test(last.text)) {
            const previousMarker = last.text.match(/^__streaming__(?:[^_]+__)?/)?.[0] ?? streamingMarker;
            const previousText = last.text.replace(/^__streaming__(?:[^_]+__)?/, "");
            const nextText = mergeStreamingText(previousText, item.text);
            const nonTextParts = (last.parts ?? []).filter((part) => part.kind !== "text");
            nextMessages[lastIndex] = {
              ...last,
              text: `${previousMarker}${nextText}`,
              parts: [{ kind: "text", text: nextText }, ...nonTextParts],
              model: item.message?.model ?? last.model,
              provider: item.message?.provider ?? last.provider,
              api: item.message?.api ?? last.api,
              timestamp: item.timestamp,
              input_tokens: usage.input_tokens ?? last.input_tokens,
              output_tokens: usage.output_tokens ?? last.output_tokens,
              cache_read_tokens: usage.cache_read_tokens ?? last.cache_read_tokens,
              cache_write_tokens: usage.cache_write_tokens ?? last.cache_write_tokens,
            };
          } else {
            nextMessages.push({
              role: "assistant",
              text: `${streamingMarker}${item.text}`,
              parts: [{ kind: "text", text: item.text }],
              model: item.message?.model,
              provider: item.message?.provider,
              api: item.message?.api,
              timestamp: item.timestamp,
              ...usage,
            });
          }

          const latestPreview = nextMessages[nextMessages.length - 1];
          const latestRenderedText = latestPreview?.text?.replace(streamingMarker, "") || item.text;
          return {
            ...currentConversation,
            lastRole: "assistant",
            latestEventType: "assistant_stream",
            lastMessage: latestRenderedText || currentConversation.lastMessage,
            previewMessages: nextMessages,
            updatedAt: item.timestamp,
            lastTime: item.lastTime,
            runtime: {
              ...currentConversation.runtime,
              activeRunId: effectiveRunId,
              activeStartedAt: currentConversation.runtime?.activeStartedAt ?? item.timestamp,
              lastRunStartedAt: currentConversation.runtime?.activeStartedAt ?? currentConversation.runtime?.lastRunStartedAt ?? item.timestamp,
              lastEventAt: item.timestamp,
              lastEventIsHeartbeat: item.isHeartbeat,
            },
          };
        });
      }),
    })));

    if (buffered.some((delta) => delta.currentConversation && delta.currentRun)) {
      onSendingChange(true);
    }
  };
  const queueTextDelta = (item: {
    sessionKey: string;
    runId?: string | null;
    text: string;
    timestamp: number;
    lastTime: string;
    message?: GatewayChatEvent["message"];
    isHeartbeat?: boolean;
    currentConversation: boolean;
    currentRun: boolean;
  }) => {
    const key = `${item.sessionKey}:${item.runId ?? activeRunIdRef.current ?? "run"}`;
    const existing = pendingTextDeltaRef.current.get(key);
    pendingTextDeltaRef.current.set(key, {
      ...item,
      text: existing ? mergeStreamingText(existing.text, item.text) : item.text,
      currentConversation: item.currentConversation || Boolean(existing?.currentConversation),
      currentRun: item.currentRun || Boolean(existing?.currentRun),
    });
    if (pendingTextDeltaTimerRef.current === null) {
      pendingTextDeltaTimerRef.current = window.setTimeout(applyBufferedTextDeltas, 50);
    }
  };

  useEffect(() => {
    if (!enabled) return;

    let mounted = true;
    let dispose: (() => void) | undefined;

    void (async () => {
      await refreshGatewayStatus();
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen<GatewayChatEvent>("clawkit://gateway-chat", (event) => {
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
            const eventRunId = chat.runId ?? activeRunIdRef.current;
            const isHeartbeatEvent = chat.isHeartbeat === true;

          // Tool stream handling
          if (chat.stream === "tool") {
            if (isTerminalRunEvent(chat.sessionKey, eventRunId)) return;
            const toolPart = mapGatewayToolStreamToPart(chat.data);
            if (!toolPart) return;
            const toolName = toolPart.kind === "tool_call" ? toolPart.tool : toolPart.tool ?? "tool";
            const toolRunId = chat.runId ?? activeRunIdRef.current ?? `tool-stream-${chat.sessionKey}`;
            
            onAgentsChange((current) => current.map((agent) => ({
              ...agent,
              conversations: agent.conversations.map((conversation) => {
                if (!conversationMatchesSessionKey(conversation, chat.sessionKey)) return conversation;
                return patchConversation(conversation, (currentConversation) => {
                  let nextMessages = [...(currentConversation.previewMessages ?? [])];
                  const toolKey = `${toolRunId}:${toolName}`;
                  const existingIndex = nextMessages.findIndex((message) =>
                    message.role?.toLowerCase() === "assistant"
                    && (message.parts ?? []).some((part) =>
                      (part.kind === "tool_call" && part.tool === toolName)
                      || (part.kind === "tool_result" && part.tool === toolName),
                    ),
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
                      lastRunStartedAt: currentConversation.runtime?.activeStartedAt ?? currentConversation.runtime?.lastRunStartedAt ?? eventTimestamp,
                      lastEventAt: eventTimestamp,
                      lastEventIsHeartbeat: isHeartbeatEvent,
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
            if (isTerminalRunEvent(chat.sessionKey, eventRunId)) return;
            const deltaFrame = extractGatewayDeltaFrame(chat);
            if (deltaFrame.deltaText === undefined && isInternalOpenClawMessage(chat.message)) return;
            if (deltaFrame.deltaText !== undefined && !deltaFrame.replace) {
              if (!deltaFrame.deltaText) return;
              queueTextDelta({
                sessionKey: chat.sessionKey,
                runId: chat.runId,
                text: deltaFrame.deltaText,
                timestamp: eventTimestamp,
                lastTime: eventLastTime,
                message: chat.message,
                isHeartbeat: isHeartbeatEvent,
                currentConversation: isCurrentConversation,
                currentRun: isCurrentRun,
              });
              return;
            }
            const deltaText = deltaFrame.deltaText ?? extractTextFromGatewayMessage(chat.message);
            const deltaParts = mapGatewayContentToParts(chat.message);
            if (!deltaText && deltaParts.length === 0) return;
            
            onAgentsChange((current) => current.map((agent) => ({
              ...agent,
              conversations: agent.conversations.map((conversation) => {
                if (!conversationMatchesSessionKey(conversation, chat.sessionKey)) return conversation;
                return patchConversation(conversation, (currentConversation) => {
                  let nextMessages = [...(currentConversation.previewMessages ?? [])];
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
                  const lastIndex = fallbackStreamingIndex >= 0 ? fallbackStreamingIndex : nextMessages.length - 1;
                  const last = nextMessages[lastIndex];
                  
                  if (last?.role === "assistant" && /^__streaming__(?:[^_]+__)?/.test(last.text)) {
                    const usage = extractUsageFromGatewayMessage(chat.message);
                    const previousMarker = last.text.match(/^__streaming__(?:[^_]+__)?/)?.[0] ?? streamingMarker;
                    const previousText = last.text.replace(/^__streaming__(?:[^_]+__)?/, "");
                    const incomingText = deltaFrame.deltaText ?? (textFromParts(deltaParts) || deltaText);
                    const snapshotText = textFromParts(deltaParts) || extractTextFromGatewayMessage(chat.message);
                    const nextText = deltaFrame.replace
                      ? incomingText || snapshotText
                      : deltaFrame.deltaText !== undefined
                        ? `${previousText}${incomingText}`
                        : mergeStreamingText(previousText, incomingText);
                    const nonTextParts = mergeStreamingParts(
                      (last.parts ?? []).filter((part) => part.kind !== "text"),
                      deltaParts.filter((part) => part.kind !== "text"),
                      "",
                    );
                    const mergedParts = nextText ? [{ kind: "text" as const, text: nextText }, ...nonTextParts] : nonTextParts;
                    nextMessages[lastIndex] = {
                      ...last,
                      text: `${previousMarker}${nextText}`,
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
                    const incomingText = deltaFrame.deltaText ?? (textFromParts(deltaParts) || deltaText);
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
                      lastRunStartedAt: currentConversation.runtime?.activeStartedAt ?? currentConversation.runtime?.lastRunStartedAt ?? eventTimestamp,
                      lastEventAt: eventTimestamp,
                      lastEventIsHeartbeat: isHeartbeatEvent,
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
            applyBufferedTextDeltas();
            if (isInternalOpenClawMessage(chat.message)) {
              return;
            }
            onTerminalChatEvent?.();
            rememberTerminalRun(chat.sessionKey, eventRunId);
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
                  let nextMessages = [...(currentConversation.previewMessages ?? [])];
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
                  const latestUserIndex = findLastMessageIndex(nextMessages, (message) => message.role?.toLowerCase() === "user");
                  const currentTurnMessages = nextMessages.slice(latestUserIndex + 1);
                  const shouldCollapseCurrentTurnFinal = (finalText || finalParts.length > 0)
                    && currentTurnMessages.some((message) =>
                      isToolOnlyAssistantMessage(message)
                      || /^__streaming__(?:[^_]+__)?/.test(message.text ?? "")
                      || isTextOnlyAssistantMessage(message),
                    );
                  if (shouldCollapseCurrentTurnFinal) {
                    const usage = extractUsageFromGatewayMessage(chat.message);
                    const finalRenderableParts = finalParts.filter((part) => part.kind !== "tool_call" && part.kind !== "tool_result");
                    const collapsedParts: MessagePart[] = finalRenderableParts.length > 0
                      ? mergeStreamingParts([], finalRenderableParts, "")
                      : [{ kind: "text", text: finalText }];
                    const renderedFinalText = collapsedParts
                      .flatMap((part) => part.kind === "text" ? [part.text] : [])
                      .join("") || finalText;
                    const preservedTurnMessages = currentTurnMessages.filter((message) =>
                      message.role?.toLowerCase() !== "assistant"
                      || isToolOnlyAssistantMessage(message)
                      || (!isTextOnlyAssistantMessage(message) && !/^__streaming__(?:[^_]+__)?/.test(message.text ?? "")),
                    );
                    nextMessages = [
                      ...nextMessages.slice(0, latestUserIndex + 1),
                      ...preservedTurnMessages,
                      {
                        role: "assistant",
                        text: renderedFinalText,
                        parts: collapsedParts,
                        model: chat.message?.model ?? currentConversation.model,
                        provider: chat.message?.provider,
                        api: chat.message?.api,
                        timestamp: eventTimestamp,
                        ...usage,
                      },
                    ];
                  } else if (last?.role === "assistant" && (last.text.startsWith(streamingMarker) || /^__streaming__(?:[^_]+__)?/.test(last.text) || duplicateAssistantIndex >= 0)) {
                  
                    const usage = extractUsageFromGatewayMessage(chat.message);
                    const fallbackText = last.text.replace(/^__streaming__(?:[^_]+__)?/, "");
                    const hasExistingToolMessages = nextMessages.some((message, index) => index !== lastIndex && hasToolParts(message.parts ?? []));
                    const finalRenderableParts = finalParts.filter((part) => part.kind !== "tool_call" && part.kind !== "tool_result");
                    const mergedFinalParts = finalParts.length > 0 && !hasExistingToolMessages
                      ? mergeStreamingParts([], finalParts, "")
                      : finalRenderableParts.length > 0
                        ? mergeStreamingParts([], finalRenderableParts, "")
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
                    const finalRenderableParts = finalParts.filter((part) => part.kind !== "tool_call" && part.kind !== "tool_result");
                    const appendedParts: MessagePart[] = finalParts.length > 0 && !hasExistingToolMessages
                      ? mergeStreamingParts([], finalParts, "")
                      : finalRenderableParts.length > 0
                        ? mergeStreamingParts([], finalRenderableParts, "")
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
                    status: chat.state === "aborted" ? "stopped" : "completed",
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
                      lastRunStartedAt: currentConversation.runtime?.activeStartedAt ?? currentConversation.runtime?.lastRunStartedAt,
                      lastEventAt: eventTimestamp,
                      lastEventIsHeartbeat: isHeartbeatEvent,
                      lastTerminalAt: eventTimestamp,
                      lastTerminalReason: chat.state === "aborted" ? "aborted" : "completed",
                    },
                  };
                });
              }),
            })));
            
            return;
          }

          // Error handling
          if (chat.state === "error") {
            applyBufferedTextDeltas();
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
                  status: "failed",
                  latestEventType: "error",
                  runtime: {
                    ...currentConversation.runtime,
                    activeRunId: undefined,
                    activeStartedAt: undefined,
                    lastRunStartedAt: currentConversation.runtime?.activeStartedAt ?? currentConversation.runtime?.lastRunStartedAt,
                    lastEventAt: Date.now(),
                    lastEventIsHeartbeat: isHeartbeatEvent,
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
      applyBufferedTextDeltas();
      dispose?.();
    };
  }, [enabled, onAgentsChange, onActiveRunIdChange, onSendingChange, onGatewayError, onGatewayStatusTextChange, onGatewayConnectedChange, refreshGatewayStatus, onTerminalChatEvent]);

  return {
    gatewayEventUnlistenRef,
  };
}
