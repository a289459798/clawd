import { extractTextFromGatewayMessage, extractUsageFromGatewayMessage, isInternalOpenClawMessage, mapGatewayContentToParts } from "./gatewayMessages";
import type { Conversation, PreviewMessage } from "../types/conversation";
import type { GatewayHistoryResult } from "../types/gateway";

export const mapGatewayHistoryMessages = (result?: GatewayHistoryResult | null): PreviewMessage[] => {
  if (!Array.isArray(result?.messages)) return [];
  return [...result.messages]
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
    .filter((message) => !isInternalOpenClawMessage(message))
    .map((message) => ({
      role: message.role,
      text: extractTextFromGatewayMessage(message),
      parts: mapGatewayContentToParts(message),
      model: message.model,
      provider: message.provider,
      api: message.api,
      timestamp: message.timestamp,
      senderLabel: message.senderLabel,
      ...extractUsageFromGatewayMessage(message),
    }));
};

export const mapNonEmptyGatewayHistoryMessages = (result?: GatewayHistoryResult | null): PreviewMessage[] => {
  return mapGatewayHistoryMessages(result).filter((message) => {
    const hasText = Boolean(message.text?.trim());
    const hasParts = Boolean(message.parts?.length);
    return hasText || hasParts || message.role?.toLowerCase() === "user";
  });
};

export const summarizeMessageUsage = (messages: PreviewMessage[]) => {
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

export const getLastAssistantMessage = (messages: PreviewMessage[]) => {
  return [...messages].reverse().find((message) => message.role?.toLowerCase() === "assistant");
};

export const resolveConversationDefaultModel = (conversation: Conversation | null, fallbackModel = "") => {
  if (!conversation) return fallbackModel;
  const lastAssistantModel = getLastAssistantMessage(conversation.previewMessages ?? [])?.model;
  if (lastAssistantModel) return lastAssistantModel;
  if (conversation.model && conversation.model !== "未配置") return conversation.model;
  return fallbackModel;
};
