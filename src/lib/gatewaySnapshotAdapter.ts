import type {
  GatewayAgentRuntime,
  GatewayAgentsListResult,
  GatewaySessionRow,
  GatewaySessionsListResult,
  GatewaySessionsPreviewResult,
  OpenClawSnapshot,
  SnapshotSession,
} from "../types/gateway";

type GatewaySnapshotInput = {
  agentsResult?: GatewayAgentsListResult | null;
  sessionsResult?: GatewaySessionsListResult | null;
  previewsResult?: GatewaySessionsPreviewResult | null;
  fallbackSnapshot?: OpenClawSnapshot | null;
};

const UNKNOWN_WORKSPACE = "未配置工作区";

function parseAgentIdFromSessionKey(key: string) {
  const match = /^agent:([^:]+):/.exec(key);
  return match?.[1];
}

function resolveFallbackAgentId(input: GatewaySnapshotInput) {
  return (
    input.agentsResult?.defaultId ??
    input.sessionsResult?.agents?.[0]?.id ??
    input.agentsResult?.agents?.[0]?.id ??
    input.fallbackSnapshot?.agents?.[0]?.id ??
    "default"
  );
}

function latestPreviewText(preview?: GatewaySessionsPreviewResult["previews"][number]) {
  const items = preview?.status === "ok" ? preview.items : [];
  return [...items].reverse().find((item) => item.text.trim())?.text;
}

function latestPreviewRole(preview?: GatewaySessionsPreviewResult["previews"][number]) {
  const items = preview?.status === "ok" ? preview.items : [];
  return [...items].reverse().find((item) => item.text.trim())?.role;
}

function buildPreviewMessages(preview?: GatewaySessionsPreviewResult["previews"][number], fallbackText?: string) {
  if (preview?.status === "ok" && preview.items.length > 0) {
    return preview.items.map((item) => ({
      role: item.role,
      text: item.text,
      parts: [{ kind: "text" as const, text: item.text }],
    }));
  }
  return fallbackText
    ? [{ role: "assistant", text: fallbackText, parts: [{ kind: "text" as const, text: fallbackText }] }]
    : [];
}

function cleanDerivedTitle(value?: string) {
  return value
    ?.replace(/\[[A-Za-z]{3}\s+\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?\s+GMT[+-]\d+\]\s*/g, "")
    .trim();
}

function normalizeAgentRuntime(session: GatewaySessionRow): GatewayAgentRuntime | undefined {
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
          runtime: rawRuntime.runtime,
          harness: rawRuntime.harness,
        }
      : undefined;
  }
  const id = (session.runtime ?? session.harness ?? "").trim();
  return id
    ? {
        id,
        label: session.runtimeLabel,
        runtime: session.runtime,
        harness: session.harness,
      }
    : undefined;
}

function normalizeLatestCompactionCheckpoint(session: GatewaySessionRow): SnapshotSession["latest_compaction_checkpoint"] | undefined {
  const checkpoint = session.latestCompactionCheckpoint;
  if (!checkpoint || typeof checkpoint.checkpointId !== "string" || typeof checkpoint.createdAt !== "number") {
    return undefined;
  }
  return {
    checkpoint_id: checkpoint.checkpointId,
    created_at: checkpoint.createdAt,
    reason: String(checkpoint.reason ?? ""),
  };
}

export function buildSnapshotFromGateway(input: GatewaySnapshotInput): OpenClawSnapshot {
  const fallbackAgentId = resolveFallbackAgentId(input);
  const sessionAgents = input.sessionsResult?.agents ?? [];
  const gatewayAgents = input.agentsResult?.agents ?? [];
  const fallbackAgents = input.fallbackSnapshot?.agents ?? [];
  const agentById = new Map<string, OpenClawSnapshot["agents"][number]>();

  for (const agent of fallbackAgents) {
    agentById.set(agent.id, agent);
  }

  for (const agent of sessionAgents) {
    agentById.set(agent.id, {
      id: agent.id,
      name: agent.name ?? agent.id,
      workspace: agent.workspace,
      model: agent.model,
      agent_dir: fallbackAgents.find((item) => item.id === agent.id)?.agent_dir,
    });
  }

  for (const agent of gatewayAgents) {
    const existing = agentById.get(agent.id);
    agentById.set(agent.id, {
      id: agent.id,
      name: agent.name ?? agent.identity?.name ?? existing?.name ?? agent.id,
      workspace: agent.workspace ?? existing?.workspace,
      model: agent.model?.primary ?? existing?.model,
      agent_dir: existing?.agent_dir,
    });
  }

  const previewsByKey = new Map((input.previewsResult?.previews ?? []).map((preview) => [preview.key, preview]));
  const sessions: SnapshotSession[] = (input.sessionsResult?.sessions ?? []).map((session) => {
    const preview = previewsByKey.get(session.key);
    const fallbackText = session.lastMessagePreview;
    const previewMessages = buildPreviewMessages(preview, fallbackText);
    const agentId = parseAgentIdFromSessionKey(session.key) ?? fallbackAgentId;
    const derivedTitle = cleanDerivedTitle(session.derivedTitle);
    const title =
      session.label ??
      derivedTitle ??
      session.displayName ??
      session.lastMessagePreview ??
      session.key;

    return {
      id: session.sessionId ?? session.key,
      agent_id: agentId,
      key: session.key,
      title,
      label: session.label,
      model: session.model,
      thinking_default: session.thinkingDefault,
      thinking_levels: session.thinkingLevels,
      updated_at: session.updatedAt ?? undefined,
      channel: session.channel ?? session.lastChannel,
      last_message: latestPreviewText(preview) ?? fallbackText,
      last_role: latestPreviewRole(preview),
      latest_event_type: session.status,
      input_tokens: session.inputTokens,
      output_tokens: session.outputTokens,
      total_tokens: session.totalTokens,
      total_tokens_fresh: session.totalTokensFresh,
      estimated_cost_usd: session.estimatedCostUsd,
      session_status: session.status,
      agent_runtime: normalizeAgentRuntime(session),
      preview_messages: previewMessages,
      transcript_preview_status: preview?.status,
      compaction_checkpoint_count: session.compactionCheckpointCount,
      latest_compaction_checkpoint: normalizeLatestCompactionCheckpoint(session),
    };
  });

  for (const session of sessions) {
    if (!agentById.has(session.agent_id)) {
      agentById.set(session.agent_id, {
        id: session.agent_id,
        name: session.agent_id,
        workspace: UNKNOWN_WORKSPACE,
      });
    }
  }

  if (agentById.size === 0) {
    agentById.set(fallbackAgentId, {
      id: fallbackAgentId,
      name: fallbackAgentId,
      workspace: UNKNOWN_WORKSPACE,
    });
  }

  return {
    agents: [...agentById.values()],
    sessions,
    connections: input.fallbackSnapshot?.connections ?? [],
    skills: input.fallbackSnapshot?.skills ?? [],
  };
}
