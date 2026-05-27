import { formatTokenCount } from "./appFormatters";
import { isConversationRunning } from "./conversationRunState";
import { isInternalOpenClawMessage } from "./gatewayMessages";
import { mergeSnapshotMessagesPreservingCurrentOrder } from "./toolStream";
import type { Conversation, ConversationAgentRuntime, ConversationRuntime, PreviewMessage } from "../types/conversation";
import type { GatewaySessionRow, OpenClawSnapshot } from "../types/gateway";
import type { Agent, BuildAgentsOptions, ModelOption } from "../types/app";

const COMPLETED_RECENT_WINDOW_MS = 10 * 60 * 1000;
const SNAPSHOT_ACTIVE_GRACE_MS = 30 * 1000;
const STALE_RUNNING_WINDOW_MS = 6 * 60 * 60 * 1000;
const FORCE_IDLE_RUNNING_WINDOW_MS = 5 * 60 * 1000;

export const deriveConversationStatus = (runtime?: ConversationRuntime) => {
  const now = Date.now();
  if (runtime?.activeRunId) {
    const lastActiveAt = runtime.lastEventAt ?? runtime.activeStartedAt;
    if (lastActiveAt && now - lastActiveAt > FORCE_IDLE_RUNNING_WINDOW_MS) {
      return "idle" as const;
    }
    if (lastActiveAt && now - lastActiveAt > STALE_RUNNING_WINDOW_MS) {
      return "stopped" as const;
    }
    return "working" as const;
  }
  if (runtime?.lastTerminalReason === "error" || runtime?.lastTerminalReason === "failed" || runtime?.lastTerminalReason === "timeout") {
    return "failed" as const;
  }
  if (
    runtime?.lastTerminalReason === "aborted"
    || runtime?.lastTerminalReason === "killed"
    || runtime?.lastTerminalReason === "cancelled"
    || runtime?.lastTerminalReason === "interrupted"
  ) {
    return "stopped" as const;
  }
  if (runtime?.lastTerminalAt && now - runtime.lastTerminalAt <= COMPLETED_RECENT_WINDOW_MS) {
    return "completed" as const;
  }
  return "idle" as const;
};

function runtimeFromGatewaySession(
  session: OpenClawSnapshot["sessions"][number],
  existingRuntime: ConversationRuntime | undefined,
  latestRole: string | undefined,
): ConversationRuntime {
  const eventAt = session.updated_at;
  const now = Date.now();
  if (session.session_status === "running") {
    if (eventAt && now - eventAt > STALE_RUNNING_WINDOW_MS) {
      return {
        ...existingRuntime,
        activeRunId: undefined,
        activeStartedAt: undefined,
        lastEventAt: eventAt,
        lastTerminalAt: existingRuntime?.lastTerminalAt ?? eventAt,
        lastTerminalReason: existingRuntime?.lastTerminalReason ?? "interrupted",
      };
    }
    return {
      ...existingRuntime,
      activeRunId: existingRuntime?.activeRunId ?? `snapshot-${session.key}`,
      activeStartedAt: existingRuntime?.activeStartedAt ?? eventAt,
      lastEventAt: eventAt,
    };
  }
  if (session.session_status === "done") {
    return {
      ...existingRuntime,
      activeRunId: undefined,
      activeStartedAt: undefined,
      lastEventAt: eventAt,
      lastTerminalAt: eventAt,
      lastTerminalReason: "completed",
    };
  }
  if (session.session_status === "failed" || session.session_status === "timeout" || session.session_status === "killed") {
    return {
      ...existingRuntime,
      activeRunId: undefined,
      activeStartedAt: undefined,
      lastEventAt: eventAt,
      lastTerminalAt: eventAt,
      lastTerminalReason: session.session_status,
    };
  }
  const canKeepFreshActiveRun = Boolean(
    existingRuntime?.activeRunId
    && existingRuntime.lastEventAt
    && now - existingRuntime.lastEventAt <= SNAPSHOT_ACTIVE_GRACE_MS,
  );
  if (canKeepFreshActiveRun) {
    return existingRuntime!;
  }
  return {
    ...existingRuntime,
    activeRunId: undefined,
    activeStartedAt: undefined,
    lastEventAt: eventAt ?? existingRuntime?.lastEventAt,
    lastTerminalAt: existingRuntime?.lastTerminalAt ?? (latestRole === "assistant" ? eventAt : undefined),
    lastTerminalReason: existingRuntime?.lastTerminalReason ?? (latestRole === "assistant" ? "completed" : undefined),
  };
}

function clearStaleActiveRuntime(runtime?: ConversationRuntime): ConversationRuntime | undefined {
  if (!runtime?.activeRunId) {
    return runtime;
  }
  const lastEventAt = runtime.lastEventAt ?? runtime.activeStartedAt;
  if (lastEventAt && Date.now() - lastEventAt <= SNAPSHOT_ACTIVE_GRACE_MS) {
    return runtime;
  }
  return {
    ...runtime,
    activeRunId: undefined,
    activeStartedAt: undefined,
    lastTerminalAt: runtime.lastTerminalAt ?? lastEventAt,
    lastTerminalReason: runtime.lastTerminalReason ?? "interrupted",
  };
}

export const patchConversation = (conversation: Conversation, updater: (conversation: Conversation) => Conversation): Conversation => {
  const next = updater(conversation);
  return {
    ...next,
    status: deriveConversationStatus(next.runtime),
  };
};

export function hasActiveAgentRun(agents: Agent[]) {
  return agents.some((agent) =>
    agent.conversations.some((conversation) => isConversationRunning(conversation)),
  );
}

export function buildAgentsFromSnapshot(
  snapshot: OpenClawSnapshot,
  currentAgentSnapshots: Agent[],
  options?: BuildAgentsOptions,
): Agent[] {
  const colors = ["#52f2c5", "#7aa2ff", "#f08b7d", "#c08bff", "#f3bf63"];
  const snapshotAgentById = new Map(snapshot.agents.map((agent) => [agent.id, agent]));
  const currentOrder = currentAgentSnapshots
    .map((agent) => snapshotAgentById.get(agent.id))
    .filter((agent): agent is OpenClawSnapshot["agents"][number] => Boolean(agent));
  const currentIds = new Set(currentOrder.map((agent) => agent.id));
  const newSnapshotAgents = snapshot.agents.filter((agent) => !currentIds.has(agent.id));
  const baseOrder = currentOrder.length > 0 ? [...currentOrder, ...newSnapshotAgents] : snapshot.agents;
  const orderedAgents = options?.priorityAgentId
    ? [
        ...baseOrder.filter((agent) => agent.id === options.priorityAgentId),
        ...baseOrder.filter((agent) => agent.id !== options.priorityAgentId),
      ]
    : baseOrder;
  return orderedAgents.map((agent, index) => {
    const existing = currentAgentSnapshots.find((item) => item.id === agent.id);
    const realSessions = snapshot.sessions
      .filter((session) => session.agent_id === agent.id)
      .map((session, sessionIndex) => {
        const latestRole = (session.last_role ?? session.preview_messages[session.preview_messages.length - 1]?.role)?.toLowerCase();
        const latestAssistantMessage = [...session.preview_messages]
          .reverse()
          .find((message) => (message.role?.toLowerCase() ?? "") === "assistant");

        const existingConversation = existing?.conversations.find((item) => item.id === session.key);
        const runtime = runtimeFromGatewaySession(session, existingConversation?.runtime, latestRole);
        const sessionMessages = (session.preview_messages || []).filter((message) => !isInternalOpenClawMessage(message)) as PreviewMessage[];
        const mergedPreviewMessages = existingConversation?.previewMessages?.length
          ? mergeSnapshotMessagesPreservingCurrentOrder(existingConversation.previewMessages, sessionMessages)
          : sessionMessages;
        const displayTitle = session.label || session.title;
        const alternateSessionKeys = session.id !== session.key ? [session.id] : undefined;
        const thinkingOptions = session.thinking_levels?.map((level) => ({
          value: level.id,
          label: level.label ?? level.id,
        }));

        return {
          id: session.key,
          alternateSessionKeys,
          title: displayTitle,
          channel: session.channel,
          parentSessionKey: session.parent_session_key,
          childSessionKeys: session.child_sessions,
          sessionKind: session.session_kind,
          status: deriveConversationStatus(runtime),
          lastMessage: (() => {
            const hasToolCalls = latestAssistantMessage?.parts?.some((p) => p.kind === "tool_call");
            const text = latestAssistantMessage?.text ?? session.last_message ?? "";
            if (hasToolCalls && text) {
              return `🔧 使用了工具 · ${text.slice(0, 50)}${text.length > 50 ? "..." : ""}`;
            }
            if (hasToolCalls) {
              return "🔧 使用了工具";
            }
            return text || "暂无回复内容";
          })(),
          previewMessages: mergedPreviewMessages,
          agentRuntime: session.agent_runtime,
          lastRole: latestRole,
          latestEventRole: session.latest_event_role?.toLowerCase(),
          latestEventType: (session.latest_event_type ?? session.session_status)?.toLowerCase(),
          lastTime: session.updated_at ? new Date(session.updated_at).toLocaleString("zh-CN") : "未知时间",
          updatedAt: session.updated_at,
          tokens: formatTokenCount(session.total_tokens),
          inputTokens: session.input_tokens,
          outputTokens: session.output_tokens,
          cacheReadTokens: session.cache_read_tokens,
          cacheWriteTokens: session.cache_write_tokens,
          totalTokens: session.total_tokens,
          model: latestAssistantMessage?.model ?? session.model ?? agent.model ?? existing?.model ?? "未配置",
          thinkingDefault: session.thinking_default,
          thinkingOptions,
          workspace: agent.workspace ?? "未配置工作区",
          visible: existingConversation?.visible ?? true,
          pinned: sessionIndex === 0,
          runtime,
          transcriptPreviewStatus: session.transcript_preview_status,
          compactionCheckpointCount: session.compaction_checkpoint_count,
          latestCompactionCheckpoint: session.latest_compaction_checkpoint
            ? {
                checkpointId: session.latest_compaction_checkpoint.checkpoint_id,
                createdAt: session.latest_compaction_checkpoint.created_at,
                reason: session.latest_compaction_checkpoint.reason,
              }
            : undefined,
        } satisfies Conversation;
      });

    return {
      id: agent.id,
      name: agent.name,
      color: existing?.color ?? colors[index % colors.length],
      status: existing?.status ?? "idle",
      model: agent.model ?? existing?.model ?? "未配置",
      mdFile: existing?.mdFile ?? `${agent.id}.md`,
      configPath: agent.agent_dir ?? existing?.configPath ?? `agents.list.${index}`,
      summary: existing?.summary ?? "来自本地 OpenClaw 配置。",
      conversations: (() => {
        if (options?.preserveExistingConversations && existing?.conversations) {
          const sessionIds = new Set(realSessions.map((s) => s.id));
          const existingNotInSnapshot = existing.conversations
            .filter((c) => !sessionIds.has(c.id))
            .map((conversation) => {
              const runtime = clearStaleActiveRuntime(conversation.runtime);
              return {
                ...conversation,
                runtime,
                status: deriveConversationStatus(runtime),
              };
            });
          const merged = [...realSessions, ...existingNotInSnapshot];
          return merged.length > 0 ? merged : existing?.conversations ?? [];
        }
        return realSessions.length > 0 ? realSessions : existing?.conversations ?? [];
      })(),
    } satisfies Agent;
  });
}

function cleanDerivedTitleFromRow(value?: string) {
  return value
    ?.replace(/\[[A-Za-z]{3}\s+\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?\s+GMT[+-]\d+\]\s*/g, "")
    .trim();
}

function normalizeAgentRuntimeFromGatewayRow(session: GatewaySessionRow): ConversationAgentRuntime | undefined {
  const rawRuntime = session.agentRuntime;
  if (typeof rawRuntime === "string") {
    const id = rawRuntime.trim();
    return id ? { id } : undefined;
  }
  if (rawRuntime && typeof rawRuntime === "object") {
    const id = (rawRuntime.id ?? rawRuntime.runtime ?? rawRuntime.harness ?? "").trim();
    return id
      ? {
          id,
          label: rawRuntime.label,
          source: rawRuntime.source,
        }
      : undefined;
  }
  const id = (session.runtime ?? session.harness ?? "").trim();
  return id
    ? {
        id,
        label: session.runtimeLabel,
      }
    : undefined;
}

function gatewayRowToRuntimeStub(row: GatewaySessionRow): OpenClawSnapshot["sessions"][number] {
  return {
    key: row.key,
    updated_at: row.updatedAt ?? undefined,
    session_status: row.status,
  } as OpenClawSnapshot["sessions"][number];
}

function compactionSummaryFromGatewayRow(row: GatewaySessionRow): Conversation["latestCompactionCheckpoint"] | undefined {
  const checkpoint = row.latestCompactionCheckpoint;
  if (!checkpoint || typeof checkpoint.checkpointId !== "string" || typeof checkpoint.createdAt !== "number") {
    return undefined;
  }
  return {
    checkpointId: checkpoint.checkpointId,
    createdAt: checkpoint.createdAt,
    reason: String(checkpoint.reason ?? ""),
  };
}

function sessionCompactionFieldsFromRow(row: GatewaySessionRow): Pick<Conversation, "compactionCheckpointCount" | "latestCompactionCheckpoint"> {
  return {
    compactionCheckpointCount: row.compactionCheckpointCount,
    latestCompactionCheckpoint: compactionSummaryFromGatewayRow(row),
  };
}

/**
 * Merge `sessions.list` rows into existing agents without rebuilding the full Gateway snapshot.
 * Rows marked as transcript source of truth keep `previewMessages` / `lastMessage` / local streaming runtime intact.
 */
export function mergeGatewaySessionRowsIntoAgents(
  agents: Agent[],
  rows: GatewaySessionRow[],
  options: { transcriptSourceOfTruthIds: Set<string> },
): Agent[] {
  const rowByKey = new Map(rows.map((row) => [row.key, row]));

  return agents.map((agent) => ({
    ...agent,
    conversations: agent.conversations.map((conversation) => {
      const row = rowByKey.get(conversation.id);
      if (!row || conversation.isDraft) {
        return conversation;
      }

      const truth = options.transcriptSourceOfTruthIds.has(conversation.id);
      const hasLocalActiveRun = Boolean(conversation.runtime?.activeRunId);
      const derivedTitle = cleanDerivedTitleFromRow(row.derivedTitle);
      const mergedTitle = row.label ?? derivedTitle ?? row.displayName ?? row.lastMessagePreview ?? conversation.title;

      if (truth && hasLocalActiveRun) {
        return patchConversation(conversation, () => ({
          ...conversation,
          title: mergedTitle,
          channel: row.channel ?? row.lastChannel ?? conversation.channel,
          parentSessionKey: row.parentSessionKey ?? conversation.parentSessionKey,
          childSessionKeys: row.childSessions ?? conversation.childSessionKeys,
          sessionKind: row.kind ?? conversation.sessionKind,
          model: row.model ?? conversation.model,
          thinkingDefault: row.thinkingDefault ?? conversation.thinkingDefault,
          thinkingOptions: row.thinkingLevels?.map((level) => ({
            value: level.id,
            label: level.label ?? level.id,
          })) ?? conversation.thinkingOptions,
          agentRuntime: normalizeAgentRuntimeFromGatewayRow(row) ?? conversation.agentRuntime,
          inputTokens: row.inputTokens ?? conversation.inputTokens,
          outputTokens: row.outputTokens ?? conversation.outputTokens,
          cacheReadTokens: conversation.cacheReadTokens,
          cacheWriteTokens: conversation.cacheWriteTokens,
          totalTokens: row.totalTokens ?? conversation.totalTokens,
          tokens: formatTokenCount(row.totalTokens ?? conversation.totalTokens ?? 0),
          updatedAt: row.updatedAt ?? conversation.updatedAt,
          lastTime: row.updatedAt ? new Date(row.updatedAt).toLocaleString("zh-CN") : conversation.lastTime,
          latestEventType: row.status ?? conversation.latestEventType,
          latestEventRole: conversation.latestEventRole,
          ...sessionCompactionFieldsFromRow(row),
        }));
      }

      const stub = gatewayRowToRuntimeStub(row);
      const runtime = runtimeFromGatewaySession(stub, conversation.runtime, conversation.lastRole);

      if (truth && !hasLocalActiveRun) {
        return patchConversation(conversation, () => ({
          ...conversation,
          title: mergedTitle,
          channel: row.channel ?? row.lastChannel ?? conversation.channel,
          parentSessionKey: row.parentSessionKey ?? conversation.parentSessionKey,
          childSessionKeys: row.childSessions ?? conversation.childSessionKeys,
          sessionKind: row.kind ?? conversation.sessionKind,
          model: row.model ?? conversation.model,
          thinkingDefault: row.thinkingDefault ?? conversation.thinkingDefault,
          thinkingOptions: row.thinkingLevels?.map((level) => ({
            value: level.id,
            label: level.label ?? level.id,
          })) ?? conversation.thinkingOptions,
          agentRuntime: normalizeAgentRuntimeFromGatewayRow(row) ?? conversation.agentRuntime,
          inputTokens: row.inputTokens ?? conversation.inputTokens,
          outputTokens: row.outputTokens ?? conversation.outputTokens,
          totalTokens: row.totalTokens ?? conversation.totalTokens,
          tokens: formatTokenCount(row.totalTokens ?? conversation.totalTokens ?? 0),
          updatedAt: row.updatedAt ?? conversation.updatedAt,
          lastTime: row.updatedAt ? new Date(row.updatedAt).toLocaleString("zh-CN") : conversation.lastTime,
          latestEventType: row.status ?? conversation.latestEventType,
          runtime,
          ...sessionCompactionFieldsFromRow(row),
        }));
      }

      return patchConversation(conversation, () => ({
        ...conversation,
        title: mergedTitle,
        channel: row.channel ?? row.lastChannel ?? conversation.channel,
        parentSessionKey: row.parentSessionKey ?? conversation.parentSessionKey,
        childSessionKeys: row.childSessions ?? conversation.childSessionKeys,
        sessionKind: row.kind ?? conversation.sessionKind,
        model: row.model ?? conversation.model,
        thinkingDefault: row.thinkingDefault ?? conversation.thinkingDefault,
        thinkingOptions: row.thinkingLevels?.map((level) => ({
          value: level.id,
          label: level.label ?? level.id,
        })) ?? conversation.thinkingOptions,
        agentRuntime: normalizeAgentRuntimeFromGatewayRow(row) ?? conversation.agentRuntime,
        inputTokens: row.inputTokens ?? conversation.inputTokens,
        outputTokens: row.outputTokens ?? conversation.outputTokens,
        totalTokens: row.totalTokens ?? conversation.totalTokens,
        tokens: formatTokenCount(row.totalTokens ?? conversation.totalTokens ?? 0),
        updatedAt: row.updatedAt ?? conversation.updatedAt,
        lastTime: row.updatedAt ? new Date(row.updatedAt).toLocaleString("zh-CN") : conversation.lastTime,
        latestEventType: row.status ?? conversation.latestEventType,
        lastRole: conversation.lastRole,
        lastMessage: row.lastMessagePreview ?? conversation.lastMessage,
        runtime,
        ...sessionCompactionFieldsFromRow(row),
      }));
    }),
  }));
}

export function resolveAgentDefaultModel(agents: Agent[], agentId: string, modelOptions: ModelOption[]) {
  const agent = agents.find((item) => item.id === agentId);
  if (agent?.model && agent.model !== "未配置") {
    return agent.model;
  }
  return modelOptions[0]?.value ?? "";
}
