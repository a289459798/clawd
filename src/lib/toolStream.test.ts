import { describe, expect, it } from "vitest";
import { buildToolTimelineItems, mergeSnapshotMessagesPreservingCurrentOrder, summarizeToolPayload } from "./toolStream";
import type { PreviewMessage } from "../types/conversation";

describe("mergeSnapshotMessagesPreservingCurrentOrder", () => {
  it("keeps optimistic local messages when gateway history is stale", () => {
    const previousUser: PreviewMessage = { role: "user", text: "上一条问题", timestamp: 1 };
    const optimisticUser: PreviewMessage = { role: "user", text: "刚发送的问题" };

    expect(mergeSnapshotMessagesPreservingCurrentOrder([previousUser, optimisticUser], [previousUser])).toEqual([
      previousUser,
      optimisticUser,
    ]);
  });

  it("keeps full thread when snapshot payload is only the latest turn", () => {
    const full: PreviewMessage[] = [
      { role: "user", text: "旧问题", timestamp: 1 },
      { role: "assistant", text: "旧回复", timestamp: 2 },
      { role: "user", text: "新问题", timestamp: 3 },
      { role: "assistant", text: "新回复", timestamp: 4 },
    ];
    const gatewayWindow: PreviewMessage[] = [
      { role: "user", text: "新问题", timestamp: 3 },
      { role: "assistant", text: "新回复", timestamp: 4 },
    ];
    expect(mergeSnapshotMessagesPreservingCurrentOrder(full, gatewayWindow)).toEqual(full);
  });

  it("replaces local streaming final text with canonical snapshot instead of duplicating it", () => {
    const current: PreviewMessage[] = [
      { role: "user", text: "讲个笑话", timestamp: 1000 },
      {
        role: "assistant",
        text: "__streaming__run-1__好的",
        parts: [{ kind: "text", text: "好的" }],
        timestamp: 2000,
      },
    ];
    const snapshot: PreviewMessage[] = [
      { role: "user", text: "讲个笑话", timestamp: 1000 },
      {
        role: "assistant",
        text: "好的",
        parts: [{ kind: "text", text: "好的" }],
        timestamp: 2500,
        model: "moonshot/kimi-k2.5",
        output_tokens: 12,
      },
    ];

    expect(mergeSnapshotMessagesPreservingCurrentOrder(current, snapshot)).toEqual([
      { role: "user", text: "讲个笑话", timestamp: 1000 },
      {
        role: "assistant",
        text: "好的",
        parts: [{ kind: "text", text: "好的" }],
        timestamp: 2500,
        model: "moonshot/kimi-k2.5",
        output_tokens: 12,
      },
    ]);
  });

  it("keeps richer structured messages when snapshot only has the same text preview", () => {
    const current: PreviewMessage[] = [
      { role: "user", text: "查文件", timestamp: 1000 },
      {
        role: "assistant",
        text: "完成了",
        parts: [
          { kind: "tool_call", tool: "read_file", args: JSON.stringify({ path: "src/App.tsx" }) },
          { kind: "tool_result", tool: "read_file", text: "export function App() {}" },
          { kind: "text", text: "完成了" },
        ],
        timestamp: 2000,
        output_tokens: 12,
      },
    ];
    const snapshot: PreviewMessage[] = [
      {
        role: "assistant",
        text: "完成了",
        parts: [{ kind: "text", text: "完成了" }],
      },
    ];

    expect(mergeSnapshotMessagesPreservingCurrentOrder(current, snapshot)).toEqual(current);
  });

  it("does not collapse repeated same text messages that are far apart", () => {
    const first: PreviewMessage = { role: "assistant", text: "收到", timestamp: 1000 };
    const second: PreviewMessage = { role: "assistant", text: "收到", timestamp: 10 * 60 * 1000 };
    expect(mergeSnapshotMessagesPreservingCurrentOrder([first], [second])).toEqual([first, second]);
  });
});

describe("buildToolTimelineItems", () => {
  it("pairs tool calls with matching results", () => {
    expect(buildToolTimelineItems([
      { kind: "tool_call", tool: "read_file", args: JSON.stringify({ path: "src/App.tsx", limit: 20 }) },
      { kind: "tool_result", tool: "read_file", text: "export function App() {}" },
    ])).toMatchObject([
      {
        tool: "read_file",
        status: "completed",
        argSummary: "path: src/App.tsx",
        outputSummary: "export function App() {}",
      },
    ]);
  });

  it("marks error-looking results as failed", () => {
    expect(buildToolTimelineItems([
      { kind: "tool_call", tool: "open_path", args: JSON.stringify({ path: "/tmp/a.xlsx" }) },
      { kind: "tool_result", tool: "open_path", text: "Not allowed to open path /tmp/a.xlsx" },
    ])[0]).toMatchObject({
      tool: "open_path",
      status: "failed",
    });
  });

  it("keeps unpaired calls visible as running", () => {
    expect(buildToolTimelineItems([
      { kind: "tool_call", tool: "search", args: JSON.stringify({ query: "cron" }) },
    ])[0]).toMatchObject({
      tool: "search",
      status: "running",
      argSummary: "query: cron",
    });
  });
});

describe("summarizeToolPayload", () => {
  it("prefers beginner-useful fields from JSON payloads", () => {
    expect(summarizeToolPayload(JSON.stringify({ ignored: true, cmd: "pnpm build", path: "package.json" }))).toBe("path: package.json · cmd: pnpm build");
  });
});
