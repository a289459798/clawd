import { describe, expect, it } from "vitest";
import { buildDefaultAgentWorkspace, normalizeAgentId, validateAgentCreateInput } from "./agentCreate";

describe("agent create helpers", () => {
  it("normalizes display names into OpenClaw agent ids", () => {
    expect(normalizeAgentId("Research Ops")).toBe("research-ops");
    expect(normalizeAgentId("  coding_agent  ")).toBe("coding_agent");
  });

  it("rejects the reserved main agent id before calling the gateway", () => {
    expect(validateAgentCreateInput({ agentId: "main", name: "主 Agent", workspace: "~/.openclaw/workspace-main" })).toBe(
      '"main" 是 OpenClaw 默认 Agent 的保留 ID，请换一个 ID。',
    );
    expect(validateAgentCreateInput({ agentId: "Main", name: "主 Agent", workspace: "~/.openclaw/workspace-main" })).toBe(
      '"main" 是 OpenClaw 默认 Agent 的保留 ID，请换一个 ID。',
    );
  });

  it("allows Chinese display names when an explicit valid id is provided", () => {
    expect(validateAgentCreateInput({ agentId: "research-cn", name: "研究助手", workspace: "~/.openclaw/workspace-research-cn" })).toBeNull();
  });

  it("rejects ids that normalize to the fallback agent id", () => {
    expect(validateAgentCreateInput({ agentId: "中文", name: "研究助手", workspace: "~/.openclaw/workspace-agent" })).toBe(
      "Agent ID 需要包含英文字母、数字、下划线或短横线。",
    );
  });

  it("builds the default workspace from the explicit agent id", () => {
    expect(buildDefaultAgentWorkspace("Research Ops")).toBe("~/.openclaw/workspace-research-ops");
  });
});
