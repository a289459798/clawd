import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Agent, ComposerAttachment, GatewayCreateSessionResult, QueuedComposerMessage } from "../types/app";
import type { MessagePart } from "../types/conversation";
import { patchConversation } from "../lib/agentsSnapshot";

interface UseMessageSenderProps {
  agents: Agent[];
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
  refreshGatewayStatus: () => Promise<void>;
}

export function useMessageSender({
  agents,
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
    options?: { restoreToComposerOnError?: boolean; requeueOnError?: QueuedComposerMessage },
  ) => {
    const optimisticUserParts: MessagePart[] = [];
    if (message) {
      optimisticUserParts.push({ kind: "text", text: message });
    }
    optimisticUserParts.push(...attachments.map((item) => ({
      kind: "image" as const,
      data: item.dataUrl,
      mime_type: item.mimeType,
      alt: item.name,
    })));

    onGatewayError(null);
    onSendingChange(true);

    // Check if draft conversation
    const targetConversation = agents.flatMap((agent) => agent.conversations).find((conversation) => conversation.id === conversationId);
    const isDraft = targetConversation?.isDraft;
    const draftAgentId = targetConversation?.draftAgentId;

    // If draft, create real session first
    let realSessionKey = conversationId;
    if (isDraft && draftAgentId) {
      try {
        await invoke("gateway_connect");
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
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        onGatewayError(messageText);
        onGatewayStatusTextChange(`创建会话失败: ${messageText}`);
        onSendingChange(false);
        return;
      }
    }

    const runId = `clawx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    onActiveRunIdChange(runId);

    onAgentsChange((current) => current.map((agent) => ({
      ...agent,
      conversations: agent.conversations.map((conversation) => {
        if (conversation.id !== realSessionKey) return conversation;
        return patchConversation(conversation, (currentConversation) => ({
          ...currentConversation,
          status: "working",
          lastRole: "user",
          lastMessage: message || (attachments.length > 0 ? `[图片] ${attachments.map((item) => item.name).join(", ")}` : currentConversation.lastMessage),
          updatedAt: Date.now(),
          lastTime: new Date().toLocaleString("zh-CN"),
          previewMessages: [
            ...(currentConversation.previewMessages ?? []),
            { role: "user", text: message || attachments.map((item) => `[图片] ${item.name}`).join("\n"), parts: optimisticUserParts },
          ],
          runtime: {
            ...currentConversation.runtime,
            activeRunId: runId,
            activeStartedAt: Date.now(),
            lastEventAt: Date.now(),
          },
        }));
      }),
    })));

    try {
      await invoke("gateway_connect");

      const updatedConversation = agents.flatMap((agent) => agent.conversations).find((conversation) => conversation.id === realSessionKey);
      if (composerModel && composerModel !== updatedConversation?.model) {
        await invoke("gateway_sessions_patch", {
          params: {
            sessionKey: realSessionKey,
            model: composerModel,
          },
        });
      }

      await invoke("gateway_chat_send", {
        params: {
          sessionKey: realSessionKey,
          message,
          idempotencyKey: runId,
          thinking: composerThinking === "off" ? null : composerThinking,
          attachments: attachments.map((item) => ({ dataUrl: item.dataUrl, mimeType: item.mimeType })),
        },
      });
      await refreshGatewayStatus();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      onGatewayError(messageText);
      onGatewayStatusTextChange(`Gateway 请求失败: ${messageText}`);
      onSendingChange(false);
      onActiveRunIdChange(null);
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
  }, [agents, composerModel, composerThinking, onAgentsChange, onGatewayError, onGatewayStatusTextChange, onSendingChange, onActiveRunIdChange, onComposerValueChange, onComposerAttachmentsChange, onQueuedMessagesChange, refreshGatewayStatus, setActiveConversationId, setExpandedConversationId]);

  return {
    sendMessageToConversation,
    autoSendingQueuedMessageRef,
  };
}
