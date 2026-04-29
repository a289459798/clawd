import { describe, expect, it } from "vitest";
import { buildAgentsFromSnapshot } from "./agentsSnapshot";
import type { OpenClawSnapshot } from "../types/gateway";

describe("buildAgentsFromSnapshot", () => {
  it("places a priority agent at the top of the list", () => {
    const snapshot: OpenClawSnapshot = {
      agents: [
        { id: "main", name: "Main" },
        { id: "research", name: "研究助手" },
      ],
      sessions: [],
      connections: [],
      skills: [],
    };

    expect(buildAgentsFromSnapshot(snapshot, [], { priorityAgentId: "research" }).map((agent) => agent.id)).toEqual([
      "research",
      "main",
    ]);
  });

  it("preserves current UI agent order across later snapshot refreshes", () => {
    const snapshot: OpenClawSnapshot = {
      agents: [
        { id: "main", name: "Main" },
        { id: "research", name: "研究助手" },
        { id: "ops", name: "运营助手" },
      ],
      sessions: [],
      connections: [],
      skills: [],
    };
    const current = buildAgentsFromSnapshot(snapshot, [], { priorityAgentId: "research" });

    expect(buildAgentsFromSnapshot(snapshot, current, { preserveExistingConversations: true }).map((agent) => agent.id)).toEqual([
      "research",
      "main",
      "ops",
    ]);
  });

  it("uses the session model directly for conversation list display", () => {
    const snapshot: OpenClawSnapshot = {
      agents: [{ id: "master", name: "Master", model: "fallback-model" }],
      sessions: [
        {
          id: "sess-1",
          agent_id: "master",
          key: "agent:master:cron:830d",
          title: "Cron session",
          model: "gpt-5.5",
          preview_messages: [],
        },
      ],
      connections: [],
      skills: [],
    };

    expect(buildAgentsFromSnapshot(snapshot, [])[0]?.conversations[0]?.model).toBe("gpt-5.5");
  });
});
