import { describe, expect, it } from "vitest";
import { buildAgentsFromSnapshot, hasActiveAgentRun } from "./agentsSnapshot";
import type { OpenClawSnapshot } from "../types/gateway";

describe("buildAgentsFromSnapshot", () => {
  it("detects active runs before expensive snapshot refreshes", () => {
    const snapshot: OpenClawSnapshot = {
      agents: [{ id: "main", name: "Main" }],
      sessions: [],
      connections: [],
      skills: [],
    };
    const agents = buildAgentsFromSnapshot(snapshot, []);
    expect(hasActiveAgentRun(agents)).toBe(false);
    expect(hasActiveAgentRun([
      {
        ...agents[0]!,
        conversations: [
          {
            id: "agent:main:direct:abc",
            title: "Active",
            status: "working",
            lastMessage: "",
            lastTime: "",
            tokens: "-",
            model: "gpt-5.5",
            workspace: "",
            visible: true,
            runtime: { activeRunId: "run-1" },
          },
        ],
      },
    ])).toBe(true);
  });

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

  it("maps session thinking levels and default onto conversations", () => {
    const snapshot: OpenClawSnapshot = {
      agents: [{ id: "master", name: "Master" }],
      sessions: [
        {
          id: "sess-1",
          agent_id: "master",
          key: "agent:master:direct:830d",
          title: "Session",
          thinking_default: "medium",
          thinking_levels: [
            { id: "off", label: "off" },
            { id: "medium", label: "medium" },
            { id: "xhigh", label: "xhigh" },
          ],
          preview_messages: [],
        },
      ],
      connections: [],
      skills: [],
    };

    expect(buildAgentsFromSnapshot(snapshot, [])[0]?.conversations[0]).toMatchObject({
      thinkingDefault: "medium",
      thinkingOptions: [
        { value: "off", label: "off" },
        { value: "medium", label: "medium" },
        { value: "xhigh", label: "xhigh" },
      ],
    });
  });
});
