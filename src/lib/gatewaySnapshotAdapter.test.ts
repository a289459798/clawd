import { describe, expect, it } from "vitest";
import { buildSnapshotFromGateway } from "./gatewaySnapshotAdapter";

describe("buildSnapshotFromGateway", () => {
  it("maps gateway agents, sessions, and previews into the existing snapshot shape", () => {
    const snapshot = buildSnapshotFromGateway({
      agentsResult: {
        defaultId: "codex",
        agents: [
          {
            id: "codex",
            name: "Codex",
            workspace: "/workspace/clawx",
            model: { primary: "gpt-5.3-codex" },
          },
        ],
      },
      sessionsResult: {
        sessions: [
          {
            key: "agent:codex:dashboard:abc",
            sessionId: "sess-1",
            label: "开发计划",
            channel: "dashboard",
            updatedAt: 1710000000000,
            inputTokens: 12,
            outputTokens: 34,
            totalTokens: 46,
            model: "gpt-5.3-codex",
          },
        ],
      },
      previewsResult: {
        ts: 1710000000100,
        previews: [
          {
            key: "agent:codex:dashboard:abc",
            status: "ok",
            items: [
              { role: "user", text: "先规划" },
              { role: "assistant", text: "可以，先写计划。" },
            ],
          },
        ],
      },
    });

    expect(snapshot.agents).toEqual([
      {
        id: "codex",
        name: "Codex",
        workspace: "/workspace/clawx",
        model: "gpt-5.3-codex",
        agent_dir: undefined,
      },
    ]);
    expect(snapshot.sessions[0]).toMatchObject({
      id: "sess-1",
      agent_id: "codex",
      key: "agent:codex:dashboard:abc",
      title: "开发计划",
      last_message: "可以，先写计划。",
      last_role: "assistant",
      input_tokens: 12,
      output_tokens: 34,
      total_tokens: 46,
    });
    expect(snapshot.sessions[0]?.preview_messages).toEqual([
      { role: "user", text: "先规划", parts: [{ kind: "text", text: "先规划" }] },
      { role: "assistant", text: "可以，先写计划。", parts: [{ kind: "text", text: "可以，先写计划。" }] },
    ]);
  });

  it("keeps fallback skills and connections while gateway migration is partial", () => {
    const snapshot = buildSnapshotFromGateway({
      sessionsResult: {
        sessions: [
          {
            key: "agent:ops:dashboard:def",
            displayName: "运维会话",
            lastMessagePreview: "正在检查日志",
          },
        ],
      },
      fallbackSnapshot: {
        agents: [],
        sessions: [],
        connections: [{ id: "telegram", name: "Telegram", enabled: true }],
        skills: [{ id: "docs", name: "Docs", location: "/tmp/docs" }],
      },
    });

    expect(snapshot.agents[0]).toMatchObject({ id: "ops", name: "ops" });
    expect(snapshot.sessions[0]).toMatchObject({
      agent_id: "ops",
      title: "运维会话",
      last_message: "正在检查日志",
      last_role: undefined,
    });
    expect(snapshot.sessions[0]?.preview_messages).toEqual([
      {
        role: "assistant",
        text: "正在检查日志",
        parts: [{ kind: "text", text: "正在检查日志" }],
      },
    ]);
    expect(snapshot.connections).toEqual([{ id: "telegram", name: "Telegram", enabled: true }]);
    expect(snapshot.skills).toEqual([{ id: "docs", name: "Docs", location: "/tmp/docs" }]);
  });

  it("uses cleaned derivedTitle when label is missing", () => {
    const snapshot = buildSnapshotFromGateway({
      sessionsResult: {
        sessions: [
          {
            key: "agent:master:cron:830d",
            derivedTitle: "[Tue 2026-04-28 12:02 GMT+8] 5b7eb144",
            displayName: "Cron: Memory Dreaming Promotion",
            model: "gpt-5.5",
            modelProvider: "openai-codex",
            thinkingDefault: "medium",
            thinkingLevels: [
              { id: "off", label: "off" },
              { id: "medium", label: "medium" },
              { id: "xhigh", label: "xhigh" },
            ],
          },
        ],
      },
    });

    expect(snapshot.sessions[0]).toMatchObject({
      key: "agent:master:cron:830d",
      title: "5b7eb144",
      label: undefined,
      model: "gpt-5.5",
      thinking_default: "medium",
      thinking_levels: [
        { id: "off", label: "off" },
        { id: "medium", label: "medium" },
        { id: "xhigh", label: "xhigh" },
      ],
    });
  });
});
