import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Agent, ComposerAttachment, GatewayCreateSessionResult, ModelOption, QueuedComposerMessage } from "../types/app";
import type { MessagePart } from "../types/conversation";
import { patchConversation } from "../lib/agentsSnapshot";
import { canonicalizeModelRef } from "../lib/modelOptions";

interface UseMessageSenderProps {
  agents: Agent[];
  modelOptions: ModelOption[];
  composerModel: string;
  composerThinking: string;
  activeConversationId: string | null;
  expandedConversationId: string;
  onAgentsChange: (updater: (current: Agent[]) => Agent[]) => void;
  onActiveConversationIdChange: (id: string | null) => void;
  onExpandedConversationIdChange: (id: string) => void;
  onQueuedMessagesChange: (updater: (current: Record<string, QueuedComposerMessage[]>) => Record<string, QueuedComposerMessage[]>) => void;
  onGatewayError: (error: string | null) => void;
  onGatewayStatusTextChange: (text: string) => void;
  onSendingChange: (sending: boolean) => void;
  onActiveRunIdChange: (runId: string | null) => void;
  onComposerValueChange: (value: string) => void;
  onComposerAttachmentsChange: (attachments: ComposerAttachment[]) => void;
  onConversationSendError: (conversationId: string, error: string | null) => void;
  refreshGatewayStatus: () => Promise<void>;
}

type GatewayChatSendResult = {
  runId?: string;
  status?: string;
};

type SendMessageOptions = {
  restoreToComposerOnError?: boolean;
  requeueOnError?: QueuedComposerMessage;
  model?: string;
  thinking?: string;
};

function assertGatewayChatSendStarted(value: unknown): GatewayChatSendResult {
  if (typeof value === "string") {
    throw new Error(value);
  }
  if (!value || typeof value !== "object") {
    throw new Error("gateway_chat_send 返回格式异常");
  }
  const result = value as GatewayChatSendResult;
  if (result.status !== "started") {
    throw new Error(`gateway_chat_send 返回状态异常: ${JSON.stringify(value)}`);
  }
  return result;
}

function isReplyRunConflictError(message: string) {
  const lower = message.toLowerCase();
  return lower.includes("replyrunalreadyactive") || /\breply\b.*\balready\b.*\bactive\b/.test(lower) || /\balready\b.*\bactive\b.*\breply\b/.test(lower);
}

export function useMessageSender({
  agents,
  modelOptions,
  composerModel,
  composerThinking,
  activeConversationId,
  expandedConversationId,
  onAgentsChange,
  onActiveConversationIdChange,
  onExpandedConversationIdChange,
  onQueuedMessagesChange,
  onGatewayError,
  onGatewayStatusTextChange,
  onSendingChange,
  onActiveRunIdChange,
  onComposerValueChange,
  onComposerAttachmentsChange,
  onConversationSendError,
  refreshGatewayStatus,
}: UseMessageSenderProps) {
  const activeConversationIdRef = useRef(activeConversationId);
  const expandedConversationIdRef = useRef(expandedConversationId);
  const [autoSendingQueuedMessageRef] = useState<{ current: string | null }>({ current: null });

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    expandedConversationIdRef.current = expandedConversationId;
  }, [expandedConversationId]);

  const setActiveConversationId = useCallback((id: string | null) => {
    activeConversationIdRef.current = id;
    onActiveConversationIdChange(id);
  }, [onActiveConversationIdChange]);

  const setExpandedConversationId = useCallback((id: string) => {
    expandedConversationIdRef.current = id;
    onExpandedConversationIdChange(id);
  }, [onExpandedConversationIdChange]);

  const sendMessageToConversation = useCallback(async (
    conversationId: string,
    message: string,
    attachments: ComposerAttachment[],
    options?: SendMessageOptions,
  ) => {
    const optimisticUserParts: MessagePart[] = [];
    if (message) {
      optimisticUserParts.push({ kind: "text", text: message });
    }
    optimisticUserParts.push(...attachments.map((item) => (
      item.mimeType.startsWith("image/")
        ? {
            kind: "image" as const,
            data: item.dataUrl,
            mime_type: item.mimeType,
            alt: item.name,
          }
        : {
            kind: "file" as const,
            name: item.name,
            mime_type: item.mimeType,
            size: item.size,
            path: item.path,
          }
    )));

    onGatewayError(null);
    onConversationSendError(conversationId, null);
    onSendingChange(true);

    // Check if draft conversation
    const targetConversation = agents.flatMap((agent) => agent.conversations).find((conversation) => conversation.id === conversationId);
    const isDraft = targetConversation?.isDraft;
    const draftAgentId = targetConversation?.draftAgentId;
    let optimisticStarted = false;
    let optimisticUserTimestamp: number | undefined;

    // If draft, create real session first
    let realSessionKey = conversationId;
    try {
      await invoke("gateway_connect");

      if (isDraft && draftAgentId) {
        const result = await invoke<GatewayCreateSessionResult>("gateway_sessions_create", {
          params: {
            agentId: draftAgentId,
            model: composerModel || null,
            message: "",
          },
        });
        if (!result.key) {
          throw new Error("创建会话失败，未返回 session key");
        }
        realSessionKey = result.key;
        onConversationSendError(realSessionKey, null);

        // Update conversation ID
        onAgentsChange((current) => current.map((agent) => ({
          ...agent,
          conversations: agent.conversations.map((conversation) => {
            if (conversation.id !== conversationId) return conversation;
            return {
              ...conversation,
              id: realSessionKey,
              isDraft: false,
              draftAgentId: undefined,
            };
          }),
        })));

        // Update active conversation ID
        if (activeConversationIdRef.current === conversationId) {
          setActiveConversationId(realSessionKey);
        }
        if (expandedConversationIdRef.current === conversationId) {
          setExpandedConversationId(realSessionKey);
        }

        // Migrate queued messages to new ID
        onQueuedMessagesChange((current) => {
          const draftQueue = current[conversationId] ?? [];
          return {
            ...current,
            [realSessionKey]: draftQueue,
          };
        });
      }

      const updatedConversation = agents.flatMap((agent) => agent.conversations).find((conversation) => conversation.id === realSessionKey) ?? targetConversation;
      const lastAssistantProvider = [...(updatedConversation?.previewMessages ?? [])]
        .reverse()
        .find((previewMessage) => previewMessage.role?.toLowerCase() === "assistant")
        ?.provider;
      const selectedModel = canonicalizeModelRef(options?.model ?? composerModel, modelOptions, lastAssistantProvider);
      const selectedThinking = options?.thinking ?? (composerThinking || "off");
      const patchParams: Record<string, unknown> = { sessionKey: realSessionKey };
      if (selectedModel && selectedModel !== "未配置") {
        patchParams.model = selectedModel;
      }
      if (selectedThinking !== (updatedConversation?.thinkingDefault ?? "off")) {
        patchParams.thinkingLevel = selectedThinking;
      }
      if (Object.keys(patchParams).length > 1) {
        await invoke("gateway_sessions_patch", {
          params: patchParams,
        });
        onAgentsChange((current) => current.map((agent) => ({
          ...agent,
          conversations: agent.conversations.map((conversation) => {
            if (conversation.id !== realSessionKey) return conversation;
            return {
              ...conversation,
              model: typeof patchParams.model === "string" ? patchParams.model : conversation.model,
              thinkingDefault: typeof patchParams.thinkingLevel === "string" ? patchParams.thinkingLevel : conversation.thinkingDefault,
            };
          }),
        })));
      }

      const runId = `clawx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      onActiveRunIdChange(runId);
      optimisticStarted = true;

      optimisticUserTimestamp = Date.now();
      onAgentsChange((current) => current.map((agent) => ({
        ...agent,
        conversations: agent.conversations.map((conversation) => {
          if (conversation.id !== realSessionKey) return conversation;
          return patchConversation(conversation, (currentConversation) => ({
            ...currentConversation,
            status: "working",
            lastRole: "user",
            lastMessage: message || (attachments.length > 0 ? `[附件] ${attachments.map((item) => item.name).join(", ")}` : currentConversation.lastMessage),
            updatedAt: optimisticUserTimestamp,
            lastTime: new Date().toLocaleString("zh-CN"),
            previewMessages: [
              ...(currentConversation.previewMessages ?? []),
              { role: "user", text: message || attachments.map((item) => `[附件] ${item.name}`).join("\n"), parts: optimisticUserParts, timestamp: optimisticUserTimestamp },
            ],
            runtime: {
              ...currentConversation.runtime,
              activeRunId: runId,
              activeStartedAt: optimisticUserTimestamp,
              lastEventAt: optimisticUserTimestamp,
            },
          }));
        }),
      })));

      const chatSendResult = await invoke<unknown>("gateway_chat_send", {
        params: {
          sessionKey: realSessionKey,
          message,
          idempotencyKey: runId,
          attachments: attachments.map((item) => ({
            dataUrl: item.dataUrl,
            mimeType: item.mimeType,
            fileName: item.name,
            type: item.mimeType.startsWith("image/") ? "image" : "file",
          })),
        },
      });
      const started = assertGatewayChatSendStarted(chatSendResult);
      if (started.runId && started.runId !== runId) {
        onActiveRunIdChange(started.runId);
        onAgentsChange((current) => current.map((agent) => ({
          ...agent,
          conversations: agent.conversations.map((conversation) => {
            if (conversation.id !== realSessionKey) return conversation;
            return patchConversation(conversation, (currentConversation) => ({
              ...currentConversation,
              runtime: {
                ...currentConversation.runtime,
                activeRunId: started.runId,
              },
            }));
          }),
        })));
      }
      await refreshGatewayStatus();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);

      if (optimisticStarted && isReplyRunConflictError(messageText)) {
        onSendingChange(false);
        onActiveRunIdChange(null);
        onGatewayError(null);
        onConversationSendError(realSessionKey, null);
        onGatewayStatusTextChange("当前仍在生成回复，这条消息已排队，将在结束后自动发送");
        onQueuedMessagesChange((current) => ({
          ...current,
          [realSessionKey]: [
            {
              id: `queued-${Date.now()}-retry`,
              text: message,
              attachments,
              createdAt: Date.now(),
            },
            ...(current[realSessionKey] ?? []),
          ],
        }));
        if (optimisticUserTimestamp != null) {
          onAgentsChange((current) => current.map((agent) => ({
            ...agent,
            conversations: agent.conversations.map((conversation) => {
              if (conversation.id !== realSessionKey) return conversation;
              const msgs = [...(conversation.previewMessages ?? [])];
              const last = msgs[msgs.length - 1];
              if (last?.role?.toLowerCase() !== "user" || last.timestamp !== optimisticUserTimestamp) {
                return patchConversation(conversation, (currentConversation) => ({
                  ...currentConversation,
                  runtime: {
                    ...currentConversation.runtime,
                    activeRunId: undefined,
                    activeStartedAt: undefined,
                  },
                }));
              }
              msgs.pop();
              return patchConversation(conversation, (currentConversation) => ({
                ...currentConversation,
                previewMessages: msgs,
                runtime: {
                  ...currentConversation.runtime,
                  activeRunId: undefined,
                  activeStartedAt: undefined,
                  lastEventAt: Date.now(),
                },
              }));
            }),
          })));
        }
        await refreshGatewayStatus();
        return;
      }

      onGatewayError(messageText);
      onConversationSendError(realSessionKey, messageText);
      let statusLine = `Gateway 请求失败: ${messageText}`;
      if (/allowlist|allow-list|model.*not permitted|not permitted.*model|blocked.*model/i.test(messageText)) {
        statusLine += " · 可将模型加入允许列表：在项目终端执行 `openclaw models allow add <provider>/<modelId>`（以 `openclaw models allow --help` 为准）";
      }
      onGatewayStatusTextChange(statusLine);
      onSendingChange(false);
      onActiveRunIdChange(null);
      if (optimisticStarted) {
        onAgentsChange((current) => current.map((agent) => ({
          ...agent,
          conversations: agent.conversations.map((conversation) => {
            if (conversation.id !== realSessionKey) return conversation;
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
      if (options?.restoreToComposerOnError) {
        onComposerValueChange(message);
        onComposerAttachmentsChange(attachments);
      }
      if (options?.requeueOnError) {
        onQueuedMessagesChange((current) => ({
          ...current,
          [realSessionKey]: [options.requeueOnError!, ...(current[realSessionKey] ?? [])],
        }));
      }
      await refreshGatewayStatus();
    }
  }, [agents, composerModel, composerThinking, modelOptions, onAgentsChange, onGatewayError, onGatewayStatusTextChange, onSendingChange, onActiveRunIdChange, onComposerValueChange, onComposerAttachmentsChange, onConversationSendError, onQueuedMessagesChange, refreshGatewayStatus, setActiveConversationId, setExpandedConversationId]);

  return {
    sendMessageToConversation,
    autoSendingQueuedMessageRef,
  };
}
