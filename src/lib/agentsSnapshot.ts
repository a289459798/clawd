import { formatTokenCount } from "./appFormatters";
import { isInternalOpenClawMessage } from "./gatewayMessages";
import type { Conversation, ConversationRuntime, PreviewMessage } from "../types/conversation";
import type { OpenClawSnapshot } from "../types/gateway";
import type { Agent, BuildAgentsOptions, ModelOption } from "../types/app";

const COMPLETED_RECENT_WINDOW_MS = 10 * 60 * 1000;
const SNAPSHOT_ACTIVE_GRACE_MS = 30 * 1000;
const STALE_RUNNING_WINDOW_MS = 6 * 60 * 60 * 1000;

export const deriveConversationStatus = (runtime?: ConversationRuntime) => {
  const now = Date.now();
  if (runtime?.activeRunId) {
    const lastActiveAt = runtime.lastEventAt ?? runtime.activeStartedAt;
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
    agent.conversations.some((conversation) => Boolean(conversation.runtime?.activeRunId)),
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
        const sessionMessages = (session.preview_messages || []).filter((message) => !isInternalOpenClawMessage(message));
        const mergedPreviewMessages = sessionMessages as PreviewMessage[];
        const displayTitle = session.label || session.title;
        const thinkingOptions = session.thinking_levels?.map((level) => ({
          value: level.id,
          label: level.label ?? level.id,
        }));

        return {
          id: session.key,
          title: displayTitle,
          channel: session.channel,
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

export function resolveAgentDefaultModel(agents: Agent[], agentId: string, modelOptions: ModelOption[]) {
  const agent = agents.find((item) => item.id === agentId);
  if (agent?.model && agent.model !== "未配置") {
    return agent.model;
  }
  return modelOptions[0]?.value ?? "";
}
