import type { GatewayAgentFileEntry } from "../types/gateway";

const AGENT_FILE_ORDER = ["AGENTS.md", "IDENTITY.md", "SOUL.md", "USER.md", "TOOLS.md", "MEMORY.md", "BOOTSTRAP.md"];

export function orderAgentFiles<T extends Pick<GatewayAgentFileEntry, "name">>(files: T[]): T[] {
  return [...files].sort((left, right) => {
    const leftIndex = AGENT_FILE_ORDER.indexOf(left.name);
    const rightIndex = AGENT_FILE_ORDER.indexOf(right.name);
    const leftRank = leftIndex === -1 ? AGENT_FILE_ORDER.length : leftIndex;
    const rightRank = rightIndex === -1 ? AGENT_FILE_ORDER.length : rightIndex;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.name.localeCompare(right.name);
  });
}

export function describeAgentFile(name: string): string {
  switch (name) {
    case "AGENTS.md":
      return "Agent 的核心工作说明，建议先完善职责、边界和偏好。";
    case "IDENTITY.md":
      return "Agent 的身份定义文件，用来描述角色、职责和行为原则。";
    case "SOUL.md":
      return "Agent 的语气、人格和长期行为约束。";
    case "USER.md":
      return "用户偏好和背景信息，帮助 Agent 更懂你的习惯。";
    case "TOOLS.md":
      return "工具使用约定和注意事项。";
    case "MEMORY.md":
      return "长期记忆入口，适合沉淀稳定事实。";
    case "BOOTSTRAP.md":
      return "初始化引导内容，通常由 OpenClaw 管理。";
    default:
      return "OpenClaw 工作区文件。";
  }
}
