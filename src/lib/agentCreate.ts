const RESERVED_AGENT_IDS = new Set(["main"]);

export function normalizeAgentId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "agent";
}

export function buildDefaultAgentWorkspace(name: string) {
  return `~/.openclaw/workspace-${normalizeAgentId(name)}`;
}

export function validateAgentCreateInput(params: { agentId: string; name: string; workspace: string }) {
  const rawAgentId = params.agentId.trim();
  if (!rawAgentId) {
    return "请输入 Agent ID。";
  }
  const agentId = normalizeAgentId(rawAgentId);
  if (agentId === "agent" && rawAgentId.toLowerCase() !== "agent") {
    return "Agent ID 需要包含英文字母、数字、下划线或短横线。";
  }
  if (agentId !== rawAgentId.toLowerCase()) {
    return "Agent ID 只能使用英文字母、数字、下划线或短横线。";
  }
  if (RESERVED_AGENT_IDS.has(agentId)) {
    return `"${agentId}" 是 OpenClaw 默认 Agent 的保留 ID，请换一个 ID。`;
  }
  const name = params.name.trim();
  if (!name) {
    return "请输入 Agent 名称。";
  }
  if (!params.workspace.trim()) {
    return "请选择或填写工作区。";
  }
  return null;
}
