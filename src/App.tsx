import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GatewayBanner, ImageLightbox, NavSidebar } from "./components/AppChrome";
import { BootstrapScreens } from "./components/BootstrapScreens";
import { ConversationWorkspace } from "./components/ConversationWorkspace";
import { ConnectionsPage, SkillsPage } from "./components/InfoPages";
import { ResourceSidebar } from "./components/ResourceSidebar";
import { getLastAssistantMessage, mapGatewayHistoryMessages, mapNonEmptyGatewayHistoryMessages, resolveConversationDefaultModel as resolveConversationModel, summarizeMessageUsage } from "./lib/conversationHistory";
import { findConversationById, getVisibleConversations } from "./lib/conversationSelectors";
import { readImageComposerAttachments } from "./lib/composerAttachments";
import { useConversationAutoScroll } from "./hooks/useConversationAutoScroll";
import { useGatewayChat } from "./hooks/useGatewayChat";
import { buildAgentsFromSnapshot, patchConversation, resolveAgentDefaultModel } from "./lib/agentsSnapshot";
import { connectionLabel, formatTokenCount, statusLabel } from "./lib/appFormatters";
import { parseSenderMeta } from "./lib/messageMeta";
import { buildModelOptions } from "./lib/modelOptions";
import { mergeSnapshotMessagesPreservingCurrentOrder } from "./lib/toolStream";
import { isInternalOpenClawMessage } from "./lib/gatewayMessages";
import type { Conversation, MessagePart, PreviewMessage } from "./types/conversation";
import type { Agent, ChannelConnection, ClawxBootstrapStatus, ComposerAttachment, GatewayCreateSessionResult, ModelOption, NavKey, QueuedComposerMessage, Skill } from "./types/app";
import type { GatewayHistoryResult, GatewayModelsResult, GatewayStatus, OpenClawSnapshot } from "./types/gateway";
import type { RealtimeGatewayEvent } from "./realtime";
import "./App.css";

const agentsSeed: Agent[] = [];
const fallbackSkills: Skill[] = [];
const fallbackConnections: ChannelConnection[] = [];

function App() {
  const [bootstrapStatus, setBootstrapStatus] = useState<ClawxBootstrapStatus | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bindingInProgress, setBindingInProgress] = useState(false);
  const [bootstrapStep, setBootstrapStep] = useState<"detect" | "install" | "bind" | "connect_test" | "ready">("detect");
  const [bootstrapConnectError, setBootstrapConnectError] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState<NavKey>("conversations");
  const [agents, setAgents] = useState(agentsSeed);
  const [expandedConversationId, setExpandedConversationId] = useState("");
  const [showResourceSidebar, setShowResourceSidebar] = useState(true);
  const [skills, setSkills] = useState<Skill[]>(fallbackSkills);
  const [connections, setConnections] = useState<ChannelConnection[]>(fallbackConnections);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const [composerValue, setComposerValue] = useState("");
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [composerModel, setComposerModel] = useState("");
  const [composerThinking, setComposerThinking] = useState("off");
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [queuedMessagesByConversation, setQueuedMessagesByConversation] = useState<Record<string, QueuedComposerMessage[]>>({});
  const [sending, setSending] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const autoSendingQueuedMessageRef = useRef<string | null>(null);
  const queuedMessagesByConversationRef = useRef<Record<string, QueuedComposerMessage[]>>({});
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [gatewayStatusText, setGatewayStatusText] = useState("Gateway 连接中...");
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const [userExpanded, setUserExpanded] = useState(false);

  useEffect(() => {
    queuedMessagesByConversationRef.current = queuedMessagesByConversation;
  }, [queuedMessagesByConversation]);

  const loadBootstrapStatus = useCallback(async () => {
    setBootstrapLoading(true);
    setBootstrapError(null);
    try {
      const status = await invoke<ClawxBootstrapStatus>("get_clawx_bootstrap_status");
      setBootstrapStatus(status);
      setBootstrapStep(!status.openclawInstalled ? "install" : status.bindingConfigured ? "ready" : "bind");
    } catch (error) {
      console.error("Failed to load clawx bootstrap status", error);
      setBootstrapError(error instanceof Error ? error.message : "读取 OpenClaw 状态失败");
    } finally {
      setBootstrapLoading(false);
    }
  }, []);

  const bindOpenClaw = useCallback(async () => {
    setBindingInProgress(true);
    setBootstrapError(null);
    setBootstrapConnectError(null);
    try {
      const status = await invoke<ClawxBootstrapStatus>("ensure_clawx_binding");
      setBootstrapStatus(status);
      setBootstrapStep(status.bindingConfigured ? "connect_test" : "bind");
    } catch (error) {
      console.error("Failed to bind OpenClaw config", error);
      setBootstrapError(error instanceof Error ? error.message : "写入 OpenClaw 配置失败");
    } finally {
      setBindingInProgress(false);
    }
  }, []);

  useEffect(() => {
    void loadBootstrapStatus();
  }, [loadBootstrapStatus]);

  useEffect(() => {
    if (!bootstrapStatus?.openclawInstalled || !bootstrapStatus.bindingConfigured) {
      return;
    }

    if (bootstrapStep === "connect_test") {
      let cancelled = false;
      void (async () => {
        setBootstrapConnectError(null);
        try {
          await invoke("gateway_connect");
          if (!cancelled) {
            setBootstrapStep("ready");
          }
        } catch (error) {
          console.error("Gateway connect test failed", error);
          if (!cancelled) {
            setBootstrapConnectError(error instanceof Error ? error.message : "Gateway 连接测试失败");
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    if (bootstrapStep !== "ready") {
      return;
    }

    let cancelled = false;

    // Ensure gateway connection on app startup (binding may already be configured).
    // gateway_connect returns "already connected" if previously established, so this is safe.
    void (async () => {
      try {
        await invoke("gateway_connect");
      } catch {
        // Ignore errors here; connection status will be reported by refreshGatewayStatus.
      }
    })();

    const loadSnapshot = async () => {
      try {
        const currentAgentSnapshots = agents;
        const snapshot = await invoke<OpenClawSnapshot>("load_openclaw_snapshot");
        if (cancelled) {
          return;
        }

        // Skip updating if there's an active run in progress to avoid overwriting runtime state
        const hasActiveRun = currentAgentSnapshots.some((agent) =>
          agent.conversations.some((conv) => conv.runtime?.activeRunId),
        );
        if (hasActiveRun) {
          return;
        }

        setAgents(buildAgentsFromSnapshot(snapshot, currentAgentSnapshots, { preserveExistingConversations: true }));

        setSkills(
          snapshot.skills.map((skill) => ({
            id: skill.id,
            name: skill.name,
            summary: "来自本地 OpenClaw skill 目录。",
            location: skill.location,
            enabled: true,
          })),
        );

        setConnections(
          snapshot.connections.map((connection) => ({
            id: connection.id,
            name: connection.name,
            status: connection.enabled ? "connected" : "disabled",
            detail: connection.enabled ? "已从本地 OpenClaw 配置读取" : "当前未启用",
            config: `channels.${connection.id}`,
            activity: connection.enabled ? "配置已启用" : "配置关闭",
          })),
        );
      } catch (error) {
        console.error("Failed to load OpenClaw snapshot", error);
      }
    };

    const loadModels = async () => {
      setModelsLoading(true);
      try {
        await invoke("gateway_connect");
        const result = await invoke<GatewayModelsResult>("gateway_models_list");
        if (!cancelled) {
          setModelOptions(buildModelOptions(result));
        }
      } catch (error) {
        console.error("Failed to load OpenClaw models", error);
        if (!cancelled) {
          setModelOptions([]);
        }
      } finally {
        if (!cancelled) {
          setModelsLoading(false);
        }
      }
    };

    // Load snapshot only once on startup
    // Polling removed to avoid overwriting frontend state (token data, streaming messages, tools)
    void loadSnapshot();
    void loadModels();

    return () => {
      cancelled = true;
    };
  }, [bootstrapStatus?.bindingConfigured, bootstrapStatus?.openclawInstalled, bootstrapStep]);

  useEffect(() => {
    if (!bootstrapStatus?.openclawInstalled || !bootstrapStatus.bindingConfigured || bootstrapStep !== "ready") {
      return;
    }
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      try {
        const subscriptionId = await invoke<number>("subscribe_gateway_realtime");
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen<RealtimeGatewayEvent>(`gateway-realtime://${subscriptionId}`, (event) => {
          const payload = event.payload;
          if (!payload || payload.type !== "session_patch") {
            return;
          }

          setAgents((current) =>
            current.map((agent) => ({
              ...agent,
              conversations: agent.conversations.map((conversation) => {
                if (conversation.id !== payload.session.key) {
                  return conversation;
                }
                const nextUpdatedAt = payload.session.updatedAt ?? conversation.updatedAt;
                const nextLastRole = payload.session.lastRole?.toLowerCase() ?? conversation.lastRole;
                const nextLatestEventType = payload.session.latestEventType?.toLowerCase() ?? conversation.latestEventType;
                const nextTotalTokens = payload.session.totalTokens ?? conversation.totalTokens;
                const nextPreviewMessages = payload.session.previewMessages?.length
                  ? (payload.session.previewMessages as PreviewMessage[]).filter((message) => !isInternalOpenClawMessage(message))
                  : conversation.previewMessages;
                const latestSnapshotMessage = nextPreviewMessages?.[nextPreviewMessages.length - 1];
                const latestSnapshotParts = latestSnapshotMessage?.parts ?? [];
                const latestIsToolOnly = latestSnapshotParts.some((part) => part.kind === "tool_call" || part.kind === "tool_result")
                  && !latestSnapshotParts.some((part) => part.kind === "text" && part.text?.trim());
                const isTerminalSnapshot = ["turn_completed", "completed", "final", "aborted", "error", "failed", "cancelled"].includes(nextLatestEventType ?? "");
                const nextRuntime = latestIsToolOnly && !isTerminalSnapshot
                  ? {
                      ...conversation.runtime,
                      activeRunId: conversation.runtime?.activeRunId ?? `snapshot-tool-${payload.session.key}`,
                      activeStartedAt: conversation.runtime?.activeStartedAt ?? nextUpdatedAt ?? Date.now(),
                      lastEventAt: nextUpdatedAt,
                    }
                  : conversation.runtime ?? {
                      activeRunId: undefined,
                      activeStartedAt: undefined,
                      lastEventAt: nextUpdatedAt,
                      lastTerminalAt: nextLastRole === "assistant" ? nextUpdatedAt : undefined,
                      lastTerminalReason: nextLastRole === "assistant" ? "completed" : undefined,
                    };
                return patchConversation(conversation, (currentConversation) => ({
                  ...currentConversation,
                  lastMessage: payload.session.lastMessage ?? currentConversation.lastMessage,
                  lastRole: nextLastRole,
                  latestEventRole: payload.session.latestEventRole?.toLowerCase() ?? currentConversation.latestEventRole,
                  latestEventType: nextLatestEventType,
                  updatedAt: nextUpdatedAt,
                  lastTime: nextUpdatedAt ? new Date(nextUpdatedAt).toLocaleString("zh-CN") : currentConversation.lastTime,
                  inputTokens: payload.session.inputTokens ?? currentConversation.inputTokens,
                  outputTokens: payload.session.outputTokens ?? currentConversation.outputTokens,
                  cacheReadTokens: payload.session.cacheReadTokens ?? currentConversation.cacheReadTokens,
                  cacheWriteTokens: payload.session.cacheWriteTokens ?? currentConversation.cacheWriteTokens,
                  totalTokens: nextTotalTokens,
                  tokens: formatTokenCount(nextTotalTokens),
                  model: payload.session.model ?? currentConversation.model,
                  previewMessages: currentConversation.runtime?.activeRunId
                    ? mergeSnapshotMessagesPreservingCurrentOrder(currentConversation.previewMessages, nextPreviewMessages)
                    : nextPreviewMessages,
                  runtime: nextRuntime,
                }));
              }),
            })),
          );
        });

        cleanup = () => {
          unlisten();
          void invoke("unsubscribe_gateway_realtime", { subscriptionId });
        };

        if (cancelled) {
          cleanup();
        }
      } catch (error) {
        console.error("Failed to subscribe realtime events", error);
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [bootstrapStatus?.bindingConfigured, bootstrapStatus?.openclawInstalled, bootstrapStep]);

  const refreshGatewayStatus = useCallback(async () => {
    try {
      const status = await invoke<GatewayStatus>("gateway_status");
      setGatewayConnected(status.connected);
      setGatewayStatusText(status.statusText || (status.connected ? "Gateway 已连接" : "Gateway 未连接"));
      setGatewayError(status.error ?? null);
      if (!status.connected) {
        const disconnectedAt = Date.now();
        setAgents((current) => current.map((agent) => ({
          ...agent,
          conversations: agent.conversations.map((conversation) => {
            if (!conversation.runtime?.activeRunId) return conversation;
            return patchConversation(conversation, (currentConversation) => ({
              ...currentConversation,
              runtime: {
                ...currentConversation.runtime,
                activeRunId: undefined,
                activeStartedAt: undefined,
                lastEventAt: disconnectedAt,
                lastTerminalAt: disconnectedAt,
                lastTerminalReason: "interrupted",
              },
            }));
          }),
        })));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const disconnectedAt = Date.now();
      setGatewayConnected(false);
      setGatewayStatusText(`Gateway 状态获取失败: ${message}`);
      setGatewayError(message);
      setAgents((current) => current.map((agent) => ({
        ...agent,
        conversations: agent.conversations.map((conversation) => {
          if (!conversation.runtime?.activeRunId) return conversation;
          return patchConversation(conversation, (currentConversation) => ({
            ...currentConversation,
            runtime: {
              ...currentConversation.runtime,
              activeRunId: undefined,
              activeStartedAt: undefined,
              lastEventAt: disconnectedAt,
              lastTerminalAt: disconnectedAt,
              lastTerminalReason: "interrupted",
            },
          }));
        }),
      })));
    }
  }, []);

  const openLocalOpenClaw = async () => {
    try {
      const dashboardUrl = await invoke<string>("resolve_dashboard_url");
      await openUrl(dashboardUrl);
    } catch (error) {
      console.error("Failed to open OpenClaw dashboard", error);
    }
  };

  useGatewayChat({
    enabled: bootstrapStep === "ready",
    activeConversationId,
    activeRunId,
    agents,
    onAgentsChange: setAgents,
    onActiveRunIdChange: setActiveRunId,
    onSendingChange: setSending,
    onGatewayError: setGatewayError,
    onGatewayStatusTextChange: setGatewayStatusText,
    onGatewayConnectedChange: setGatewayConnected,
    refreshGatewayStatus,
  });

  const visibleConversations = useMemo(() => getVisibleConversations(agents), [agents]);

  const filteredVisibleConversations = visibleConversations;

  // Always get activeConversation from agents to ensure we have the latest data
  // (including previewMessages updated by gateway_chat_history)
  const activeConversation = findConversationById(agents, activeConversationId);

  const resolveConversationDefaultModel = useCallback((conversation: Conversation | null) => {
    return resolveConversationModel(conversation, modelOptions[0]?.value ?? "");
  }, [modelOptions]);

  // Update composer model when conversation changes or previewMessages update
  useEffect(() => {
    setComposerModel(resolveConversationDefaultModel(activeConversation));
  }, [activeConversation?.id, resolveConversationDefaultModel]);

  // 创建本地草稿对话，不调用 API
  const handleCreateConversation = useCallback((agentId: string) => {
    // 检查是否已存在该 agent 的草稿对话
    const existingDraft = agents
      .find((a) => a.id === agentId)
      ?.conversations.find((c) => c.isDraft);

    if (existingDraft) {
      // 如果存在草稿，直接打开现有的
      setExpandedConversationId(existingDraft.id);
      setActiveConversationId(existingDraft.id);
      return;
    }

    const now = Date.now();
    const draftId = `draft-${agentId}-${now}`;
    const defaultModel = resolveAgentDefaultModel(agents, agentId, modelOptions);

    setAgents((current) => current.map((agent) => {
      if (agent.id !== agentId) return agent;
      const nextConversation: Conversation = {
        id: draftId,
        title: "新对话",
        status: "idle",
        lastMessage: "",
        lastTime: new Date().toLocaleString("zh-CN"),
        updatedAt: now,
        tokens: "--",
        model: defaultModel || "未配置",
        workspace: "/Users/zhangzy/clawd",
        visible: true,
        previewMessages: [],
        isDraft: true,
        draftAgentId: agentId,
      };
      return {
        ...agent,
        conversations: [nextConversation, ...agent.conversations],
      };
    }));
    setExpandedConversationId(draftId);
    setActiveConversationId(draftId);
  }, [agents, modelOptions]);

  const toggleConversationVisibility = (agentId: string, conversationId: string, visible: boolean) => {
    setAgents((current) =>
      current.map((agent) =>
        agent.id !== agentId
          ? agent
          : {
              ...agent,
              conversations: agent.conversations.map((conversation) =>
                conversation.id !== conversationId ? conversation : { ...conversation, visible },
              ),
            },
      ),
    );

    if (visible) {
      setExpandedConversationId(conversationId);
    } else if (expandedConversationId === conversationId) {
      setExpandedConversationId("");
    }
  };

  const openConversationDetail = async (conversationId: string, preserveStatus = false) => {
    setActiveConversationId(conversationId);
    setUserExpanded(false);
    try {
      // Ensure gateway is connected first
      await invoke("gateway_connect");
      const result = await invoke<GatewayHistoryResult>("gateway_chat_history", { params: { sessionKey: conversationId, limit: 200 } });
      await refreshGatewayStatus();
      if (Array.isArray(result?.messages)) {
        const mappedMessages = mapGatewayHistoryMessages(result);
        const lastAssistant = getLastAssistantMessage(mappedMessages);
        const { inputTokens: totalInput, outputTokens: totalOutput, cacheReadTokens: totalCacheRead, cacheWriteTokens: totalCacheWrite, totalTokens } = summarizeMessageUsage(mappedMessages);
        // Get last assistant message info
        const lastRole = mappedMessages.length > 0 ? (mappedMessages[mappedMessages.length - 1].role || "user") : undefined;
        setAgents((current) => current.map((agent) => ({
          ...agent,
          conversations: agent.conversations.map((conversation) => {
            if (conversation.id !== conversationId) return conversation;
            // If preserveStatus is true, preserve all status-related fields
            // This is used when reloading data while already in the conversation
            if (preserveStatus) {
              return {
                ...conversation,
                previewMessages: mappedMessages,
                lastMessage: lastAssistant?.text || conversation.lastMessage,
                model: lastAssistant?.model || conversation.model,
                inputTokens: totalInput,
                outputTokens: totalOutput,
                cacheReadTokens: totalCacheRead,
                cacheWriteTokens: totalCacheWrite,
                totalTokens,
                tokens: formatTokenCount(totalTokens),
                // Preserve all status-related fields
                status: conversation.status,
                lastRole: conversation.lastRole,
                runtime: conversation.runtime,
              };
            }
            // Normal update with status calculation
            const updatedConversation = {
              ...conversation,
              previewMessages: mappedMessages,
              lastRole,
              lastMessage: lastAssistant?.text || conversation.lastMessage,
              model: lastAssistant?.model || conversation.model,
              inputTokens: totalInput,
              outputTokens: totalOutput,
              cacheReadTokens: totalCacheRead,
              cacheWriteTokens: totalCacheWrite,
              totalTokens,
              tokens: formatTokenCount(totalTokens),
              runtime: conversation.runtime ?? {
                activeRunId: undefined,
                activeStartedAt: undefined,
                lastEventAt: conversation.updatedAt,
                lastTerminalAt: lastAssistant ? conversation.updatedAt : undefined,
                lastTerminalReason: lastAssistant ? "completed" : undefined,
              },
            };
            return patchConversation(conversation, () => updatedConversation);
          }),
        })));
      }
    } catch (error) {
      await refreshGatewayStatus();
      console.error("Failed to load chat history", error);
    }
  };

  const { aiResponseScrollRef, shouldStickToBottomRef, showJumpToBottom, setShowJumpToBottom } = useConversationAutoScroll(activeConversation);

  const handleComposerFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    if (!Array.from(fileList).some((file) => file.type.startsWith("image/"))) {
      setGatewayError("当前只支持上传图片");
      return;
    }
    const next = await readImageComposerAttachments(fileList);
    setComposerAttachments((current) => [...current, ...next]);
  }, []);

  const removeComposerAttachment = useCallback((attachmentId: string) => {
    setComposerAttachments((current) => current.filter((item) => item.id !== attachmentId));
  }, []);

  const activeQueuedMessages = activeConversationId ? queuedMessagesByConversation[activeConversationId] ?? [] : [];

  const enqueueComposerMessage = useCallback((conversationId: string, text: string, attachments: ComposerAttachment[]) => {
    const item: QueuedComposerMessage = {
      id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      attachments,
      createdAt: Date.now(),
    };
    setQueuedMessagesByConversation((current) => ({
      ...current,
      [conversationId]: [...(current[conversationId] ?? []), item],
    }));
  }, []);

  const removeQueuedMessage = useCallback((messageId: string) => {
    if (!activeConversationId) return;
    setQueuedMessagesByConversation((current) => ({
      ...current,
      [activeConversationId]: (current[activeConversationId] ?? []).filter((item) => item.id !== messageId),
    }));
  }, [activeConversationId]);

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

    setGatewayError(null);
    setSending(true);

    // 检查是否是草稿对话
    const targetConversation = agents.flatMap((agent) => agent.conversations).find((conversation) => conversation.id === conversationId);
    const isDraft = targetConversation?.isDraft;
    const draftAgentId = targetConversation?.draftAgentId;

    // 如果是草稿，先创建真实 session
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

        // 更新对话 ID 和相关状态
        setAgents((current) => current.map((agent) => ({
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

        // 更新当前激活的对话 ID
        if (activeConversationId === conversationId) {
          setActiveConversationId(realSessionKey);
        }
        if (expandedConversationId === conversationId) {
          setExpandedConversationId(realSessionKey);
        }

        // 迁移排队消息到新 ID
        setQueuedMessagesByConversation((current) => {
          const draftQueue = current[conversationId] ?? [];
          return {
            ...current,
            [realSessionKey]: draftQueue,
          };
        });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        setGatewayError(messageText);
        setGatewayStatusText(`创建会话失败: ${messageText}`);
        setSending(false);
        return;
      }
    }

    setAgents((current) => current.map((agent) => ({
      ...agent,
      conversations: agent.conversations.map((conversation) => {
        if (conversation.id !== realSessionKey) return conversation;
        return {
          ...conversation,
          status: "working",
          lastRole: "user",
          lastMessage: message || (attachments.length > 0 ? `[图片] ${attachments.map((item) => item.name).join(", ")}` : conversation.lastMessage),
          updatedAt: Date.now(),
          lastTime: new Date().toLocaleString("zh-CN"),
          previewMessages: [
            ...(conversation.previewMessages ?? []),
            { role: "user", text: message || attachments.map((item) => `[图片] ${item.name}`).join("\n"), parts: optimisticUserParts },
          ],
        };
      }),
    })));

    try {
      await invoke("gateway_connect");
      const runId = `clawx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setActiveRunId(runId);
      setAgents((current) => current.map((agent) => ({
        ...agent,
        conversations: agent.conversations.map((conversation) => {
          if (conversation.id !== realSessionKey) return conversation;
          return patchConversation(conversation, (currentConversation) => ({
            ...currentConversation,
            runtime: {
              ...currentConversation.runtime,
              activeRunId: runId,
              activeStartedAt: Date.now(),
              lastEventAt: Date.now(),
            },
          }));
        }),
      })));

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
      setGatewayError(messageText);
      setGatewayStatusText(`Gateway 请求失败: ${messageText}`);
      setSending(false);
      setActiveRunId(null);
      if (options?.restoreToComposerOnError) {
        setComposerValue(message);
        setComposerAttachments(attachments);
      }
      if (options?.requeueOnError) {
        setQueuedMessagesByConversation((current) => ({
          ...current,
          [realSessionKey]: [options.requeueOnError!, ...(current[realSessionKey] ?? [])],
        }));
      }
      await refreshGatewayStatus();
    }
  }, [agents, composerModel, composerThinking, refreshGatewayStatus, activeConversationId, expandedConversationId, setActiveConversationId, setExpandedConversationId, setQueuedMessagesByConversation]);

  const handleAbort = useCallback(async () => {
    if (!activeConversationId || !sending) return;
    try {
      await invoke("gateway_connect");
      await invoke("gateway_chat_abort", {
        sessionKey: activeConversationId,
        runId: activeRunId,
      });
      setGatewayError(null);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setGatewayError(messageText);
      setGatewayStatusText(`停止失败: ${messageText}`);
    }
  }, [activeConversationId, activeRunId, sending]);

  const handleSend = useCallback(async () => {
    if (!activeConversationId) return;
    const message = composerValue.trim();
    const attachments = composerAttachments;
    if (!message && attachments.length === 0) return;

    const shouldQueue = sending || activeConversation?.status === "working" || Boolean(activeConversation?.runtime?.activeRunId);
    setComposerValue("");
    setComposerAttachments([]);

    if (shouldQueue) {
      enqueueComposerMessage(activeConversationId, message, attachments);
      return;
    }

    await sendMessageToConversation(activeConversationId, message, attachments, { restoreToComposerOnError: true });
  }, [activeConversation, activeConversationId, composerAttachments, composerValue, enqueueComposerMessage, sendMessageToConversation, sending]);

  useEffect(() => {
    if (!activeConversationId || !activeConversation || sending) return;
    if (activeConversation.status === "working" || activeConversation.runtime?.activeRunId) return;
    const nextQueuedMessage = queuedMessagesByConversation[activeConversationId]?.[0];
    if (!nextQueuedMessage) return;
    if (autoSendingQueuedMessageRef.current === nextQueuedMessage.id) return;

    autoSendingQueuedMessageRef.current = nextQueuedMessage.id;
    const remainingQueuedMessages = (queuedMessagesByConversationRef.current[activeConversationId] ?? []).filter((item) => item.id !== nextQueuedMessage.id);
    setQueuedMessagesByConversation((current) => ({
      ...current,
      [activeConversationId]: remainingQueuedMessages,
    }));
    void sendMessageToConversation(activeConversationId, nextQueuedMessage.text, nextQueuedMessage.attachments, { requeueOnError: nextQueuedMessage })
      .finally(() => {
        if (autoSendingQueuedMessageRef.current === nextQueuedMessage.id) {
          autoSendingQueuedMessageRef.current = null;
        }
        if (remainingQueuedMessages.length > 0) {
          setSending(false);
          setActiveRunId(null);
        }
      });
  }, [activeConversation, activeConversationId, queuedMessagesByConversation, sendMessageToConversation, sending]);




  const bootstrapScreen = (
    <BootstrapScreens
      bootstrapLoading={bootstrapLoading}
      bootstrapError={bootstrapError}
      bootstrapStatus={bootstrapStatus}
      bootstrapStep={bootstrapStep}
      bootstrapConnectError={bootstrapConnectError}
      bindingInProgress={bindingInProgress}
      onLoadBootstrapStatus={() => void loadBootstrapStatus()}
      onBindOpenClaw={() => void bindOpenClaw()}
      onSetBootstrapStep={setBootstrapStep}
    />
  );

  if (bootstrapScreen) {
    const shouldShowBootstrap = bootstrapLoading
      || Boolean(bootstrapError)
      || !bootstrapStatus?.openclawInstalled
      || !bootstrapStatus?.bindingConfigured
      || bootstrapStep === "connect_test"
      || Boolean(bootstrapConnectError);
    if (shouldShowBootstrap) return bootstrapScreen;
  }

  return (
    <main className="app-shell">
      <GatewayBanner connected={gatewayConnected} statusText={gatewayStatusText} error={gatewayError} />
      <ImageLightbox src={previewImageSrc} onClose={() => setPreviewImageSrc(null)} />
      <div
        className={`layout no-topbar ${
          activeNav === "conversations"
            ? showResourceSidebar
              ? "with-resource-sidebar"
              : "without-resource-sidebar"
            : "content-only"
        }`}
      >
        <NavSidebar activeNav={activeNav} onNavChange={setActiveNav} onOpenLocalOpenClaw={() => void openLocalOpenClaw()} />

        {activeNav === "conversations" ? (
          <>
            <ResourceSidebar
              agents={agents}
              expandedConversationId={expandedConversationId}
              statusLabel={statusLabel}
              visible={showResourceSidebar}
              onCreateConversation={(agentId) => void handleCreateConversation(agentId)}
              onToggleConversationVisibility={toggleConversationVisibility}
              onExpandedConversationChange={setExpandedConversationId}
              onOpenConversation={openConversationDetail}
              onCollapse={() => setShowResourceSidebar(false)}
              onExpand={() => setShowResourceSidebar(true)}
            />

            <ConversationWorkspace
              activeConversation={activeConversation}
              visibleConversations={visibleConversations}
              filteredVisibleConversations={filteredVisibleConversations}
              statusLabel={statusLabel}
              userExpanded={userExpanded}
              aiResponseScrollRef={aiResponseScrollRef}
              showJumpToBottom={showJumpToBottom}
              shouldStickToBottomRef={shouldStickToBottomRef}
              composerFocused={composerFocused}
              composerValue={composerValue}
              composerModel={composerModel}
              composerThinking={composerThinking}
              sending={sending}
              composerAttachments={composerAttachments}
              activeQueuedMessages={activeQueuedMessages}
              modelOptions={modelOptions}
              modelsLoading={modelsLoading}
              onBack={() => setActiveConversationId(null)}
              onUserExpandedChange={setUserExpanded}
              onJumpToBottomHidden={() => setShowJumpToBottom(false)}
              onUpdateTitle={async (conversationId, newTitle) => {
                let isDraftConversation = false;
                setAgents((current) => current.map((agent) => ({
                  ...agent,
                  conversations: agent.conversations.map((conversation) => {
                    if (conversation.id === conversationId) {
                      isDraftConversation = conversation.isDraft ?? false;
                      return { ...conversation, title: newTitle };
                    }
                    return conversation;
                  }),
                })));
                if (!isDraftConversation) {
                  try {
                    await invoke("gateway_sessions_patch", {
                      params: {
                        sessionKey: conversationId,
                        label: newTitle,
                      },
                    });
                  } catch (error) {
                    console.error("更新 session title 失败:", error);
                  }
                }
              }}
              parseSenderMeta={parseSenderMeta}
              onOpenImage={setPreviewImageSrc}
              formatTokenCount={formatTokenCount}
              onOpenConversation={openConversationDetail}
              onHideConversation={(agentId, conversationId) => toggleConversationVisibility(agentId, conversationId, false)}
              onFocusChange={setComposerFocused}
              onValueChange={setComposerValue}
              onModelChange={setComposerModel}
              onThinkingChange={setComposerThinking}
              onFilesSelected={handleComposerFiles}
              onRemoveAttachment={removeComposerAttachment}
              onRemoveQueuedMessage={removeQueuedMessage}
              onSend={handleSend}
              onAbort={handleAbort}
            />
          </>
        ) : null}

        {activeNav === "skills" ? <SkillsPage skills={skills} /> : null}

        {activeNav === "connections" ? <ConnectionsPage connections={connections} connectionLabel={connectionLabel} /> : null}
      </div>
    </main>
  );
}

export default App;
