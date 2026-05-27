import { describe, expect, it } from "vitest";
import { buildAgentsFromSnapshot, hasActiveAgentRun, mergeGatewaySessionRowsIntoAgents } from "./agentsSnapshot";
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

  it("does not replace loaded structured history with short text-only previews", () => {
    const sessionKey = "agent:master:direct:830d";
    const snapshot: OpenClawSnapshot = {
      agents: [{ id: "master", name: "Master" }],
      sessions: [
        {
          id: sessionKey,
          agent_id: "master",
          key: sessionKey,
          title: "Session",
          total_tokens: 100,
          preview_messages: [
            { role: "assistant", text: "完成了", parts: [{ kind: "text", text: "完成了" }] },
          ],
        },
      ],
      connections: [],
      skills: [],
    };
    const current = [
      {
        id: "master",
        name: "Master",
        color: "#fff",
        status: "idle" as const,
        model: "gpt-5.5",
        mdFile: "",
        configPath: "",
        summary: "",
        conversations: [
          {
            id: sessionKey,
            title: "Session",
            status: "idle" as const,
            lastMessage: "完成了",
            lastTime: "—",
            tokens: "42",
            model: "gpt-5.5",
            workspace: "",
            visible: true,
            previewMessages: [
              { role: "user", text: "查一下文件", timestamp: 1 },
              {
                role: "assistant",
                text: "完成了",
                timestamp: 2,
                output_tokens: 42,
                parts: [
                  { kind: "tool_call" as const, tool: "read_file", args: JSON.stringify({ path: "src/App.tsx" }) },
                  { kind: "tool_result" as const, tool: "read_file", text: "export function App() {}" },
                  { kind: "text" as const, text: "完成了" },
                ],
              },
            ],
          },
        ],
      },
    ];

    const conversation = buildAgentsFromSnapshot(snapshot, current)[0]?.conversations[0];
    expect(conversation?.tokens).toBe("100");
    expect(conversation?.previewMessages?.[1]?.parts).toEqual(current[0]!.conversations[0]!.previewMessages![1]!.parts);
    expect(conversation?.previewMessages?.[1]?.output_tokens).toBe(42);
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

  it("carries agent runtime metadata onto conversations", () => {
    const snapshot: OpenClawSnapshot = {
      agents: [{ id: "master", name: "Master" }],
      sessions: [
        {
          id: "sess-1",
          agent_id: "master",
          key: "agent:master:direct:830d",
          title: "Session",
          agent_runtime: { id: "codex", label: "Codex", source: "agent" },
          preview_messages: [],
        },
      ],
      connections: [],
      skills: [],
    };

    expect(buildAgentsFromSnapshot(snapshot, [])[0]?.conversations[0]?.agentRuntime).toEqual({
      id: "codex",
      label: "Codex",
      source: "agent",
    });
  });

  it("maps gateway session status to conversation runtime status", () => {
    const baseSession = {
      id: "sess-1",
      agent_id: "master",
      key: "agent:master:direct:830d",
      title: "Session",
      updated_at: Date.now(),
      preview_messages: [],
    };
    const buildStatus = (session_status: "running" | "done" | "failed" | "killed" | "timeout") => buildAgentsFromSnapshot({
      agents: [{ id: "master", name: "Master" }],
      sessions: [{ ...baseSession, session_status }],
      connections: [],
      skills: [],
    }, [])[0]?.conversations[0];

    expect(buildStatus("running")?.status).toBe("working");
    expect(buildStatus("done")?.status).toBe("completed");
    expect(buildStatus("failed")?.status).toBe("failed");
    expect(buildStatus("timeout")?.status).toBe("failed");
    expect(buildStatus("killed")?.status).toBe("stopped");
  });

  it("treats stale gateway running sessions as stopped", () => {
    const oldTimestamp = Date.now() - 8 * 60 * 60 * 1000;
    const snapshot: OpenClawSnapshot = {
      agents: [{ id: "master", name: "Master" }],
      sessions: [
        {
          id: "sess-1",
          agent_id: "master",
          key: "agent:master:direct:stale",
          title: "Old running session",
          updated_at: oldTimestamp,
          session_status: "running",
          preview_messages: [],
        },
      ],
      connections: [],
      skills: [],
    };

    const conversation = buildAgentsFromSnapshot(snapshot, [])[0]?.conversations[0];
    expect(conversation?.runtime?.activeRunId).toBeUndefined();
    expect(conversation?.status).toBe("stopped");
  });

  it("does not preserve stale active runs when gateway no longer reports running", () => {
    const tenMinutesAgo = Date.now() - 20 * 60 * 1000;
    const snapshot: OpenClawSnapshot = {
      agents: [{ id: "master", name: "Master" }],
      sessions: [
        {
          id: "sess-1",
          agent_id: "master",
          key: "agent:master:direct:830d",
          title: "Session",
          updated_at: tenMinutesAgo,
          last_role: "assistant",
          preview_messages: [],
        },
      ],
      connections: [],
      skills: [],
    };

    const agents = buildAgentsFromSnapshot(snapshot, [
      {
        id: "master",
        name: "Master",
        color: "#fff",
        status: "idle",
        model: "gpt-5.5",
        mdFile: "master.md",
        configPath: "agents.master",
        summary: "",
        conversations: [
          {
            id: "agent:master:direct:830d",
            title: "Session",
            status: "working",
            lastMessage: "",
            lastTime: "",
            tokens: "-",
            model: "gpt-5.5",
            workspace: "",
            visible: true,
            runtime: {
              activeRunId: "stale-run",
              activeStartedAt: tenMinutesAgo,
              lastEventAt: tenMinutesAgo,
            },
          },
        ],
      },
    ]);

    expect(agents[0]?.conversations[0]?.runtime?.activeRunId).toBeUndefined();
    expect(agents[0]?.conversations[0]?.status).toBe("idle");
  });
});

describe("mergeGatewaySessionRowsIntoAgents", () => {
  const sessionKey = "agent:main:direct:abc";

  const baseConversation = {
    id: sessionKey,
    title: "Old title",
    status: "idle" as const,
    lastMessage: "Local last line",
    lastTime: "—",
    tokens: "-",
    model: "m1",
    workspace: "",
    visible: true,
  };

  const wrapAgent = (conversation: typeof baseConversation & { isDraft?: boolean; runtime?: { activeRunId?: string; lastEventAt?: number }; previewMessages?: Array<{ role?: string; text: string }> }) => ({
    id: "main",
    name: "Main",
    color: "#fff",
    status: "idle" as const,
    model: "m1",
    mdFile: "",
    configPath: "",
    summary: "",
    conversations: [conversation],
  });

  it("applies gateway last message when the session is not the transcript source of truth", () => {
    const merged = mergeGatewaySessionRowsIntoAgents(
      [wrapAgent(baseConversation)],
      [
        {
          key: sessionKey,
          lastMessagePreview: "Gateway preview",
          derivedTitle: "Row title",
          status: "done",
          updatedAt: 1_700_000_000_000,
          totalTokens: 100,
        },
      ],
      { transcriptSourceOfTruthIds: new Set() },
    );
    const c = merged[0]!.conversations[0]!;
    expect(c.lastMessage).toBe("Gateway preview");
    expect(c.title).toBe("Row title");
    expect(c.tokens).toBe("100");
  });

  it("keeps local transcript and active run when merge marks session as transcript source of truth", () => {
    const merged = mergeGatewaySessionRowsIntoAgents(
      [
        wrapAgent({
          ...baseConversation,
          runtime: { activeRunId: "run-local", lastEventAt: Date.now() },
          previewMessages: [{ role: "assistant", text: "streaming…" }],
        }),
      ],
      [
        {
          key: sessionKey,
          lastMessagePreview: "Stale gateway preview",
          derivedTitle: "Fresh title from row",
          status: "running",
          updatedAt: Date.now(),
          totalTokens: 42,
        },
      ],
      { transcriptSourceOfTruthIds: new Set([sessionKey]) },
    );
    const c = merged[0]!.conversations[0]!;
    expect(c.lastMessage).toBe("Local last line");
    expect(c.previewMessages).toEqual([{ role: "assistant", text: "streaming…" }]);
    expect(c.runtime?.activeRunId).toBe("run-local");
    expect(c.title).toBe("Fresh title from row");
    expect(c.tokens).toBe("42");
  });

  it("does not merge gateway rows into draft conversations", () => {
    const merged = mergeGatewaySessionRowsIntoAgents(
      [wrapAgent({ ...baseConversation, id: "draft-1", isDraft: true })],
      [{ key: "draft-1", derivedTitle: "Should not apply", lastMessagePreview: "x" }],
      { transcriptSourceOfTruthIds: new Set() },
    );
    expect(merged[0]!.conversations[0]!.title).toBe("Old title");
    expect(merged[0]!.conversations[0]!.lastMessage).toBe("Local last line");
  });

  it("merges gateway terminal runtime when transcript is source of truth but there is no local active run", () => {
    const merged = mergeGatewaySessionRowsIntoAgents(
      [
        wrapAgent({
          ...baseConversation,
          runtime: { lastEventAt: Date.now() - 120_000 },
        }),
      ],
      [
        {
          key: sessionKey,
          status: "done",
          updatedAt: Date.now(),
        },
      ],
      { transcriptSourceOfTruthIds: new Set([sessionKey]) },
    );
    const c = merged[0]!.conversations[0]!;
    expect(c.runtime?.activeRunId).toBeUndefined();
    expect(c.runtime?.lastTerminalReason).toBe("completed");
  });

  it("merges compaction metadata from gateway session rows", () => {
    const merged = mergeGatewaySessionRowsIntoAgents(
      [wrapAgent(baseConversation)],
      [
        {
          key: sessionKey,
          compactionCheckpointCount: 3,
          latestCompactionCheckpoint: {
            checkpointId: "ck",
            createdAt: 1_711_000_000_000,
            reason: "auto-threshold",
          },
          status: "done",
          updatedAt: Date.now(),
        },
      ],
      { transcriptSourceOfTruthIds: new Set() },
    );
    const c = merged[0]!.conversations[0]!;
    expect(c.compactionCheckpointCount).toBe(3);
    expect(c.latestCompactionCheckpoint).toEqual({
      checkpointId: "ck",
      createdAt: 1_711_000_000_000,
      reason: "auto-threshold",
    });
  });
});
