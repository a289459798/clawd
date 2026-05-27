import { describe, expect, it } from "vitest";
import { getConversationDetailState } from "./conversationDetailState";
import type { PreviewMessage } from "../types/conversation";

describe("getConversationDetailState", () => {
  it("collapses repeated assistant text snapshots around tool messages", () => {
    const messages: PreviewMessage[] = [
      { role: "user", text: "分析股票", timestamp: 1 },
      { role: "assistant", text: "__streaming__run-1__让我立即分析合力泰（002217.SZ），需要重点关注：", parts: [{ kind: "text", text: "让我立即分析合力泰（002217.SZ），需要重点关注：" }], timestamp: 2 },
      { role: "assistant", text: "run-1:exec", parts: [{ kind: "tool_call", tool: "exec", args: "{\"cmd\":\"kline\"}" }], timestamp: 3 },
      { role: "assistant", text: "__streaming__run-1__让我立即分析合力泰（002217.SZ），需要重点关注：", parts: [{ kind: "text", text: "让我立即分析合力泰（002217.SZ），需要重点关注：" }], timestamp: 4 },
    ];

    const state = getConversationDetailState(messages, "assistant", true);

    expect(state.normalizedMessages.map((message) => message.text)).toEqual([
      "分析股票",
      "run-1:exec",
      "让我立即分析合力泰（002217.SZ），需要重点关注：",
    ]);
  });

  it("keeps the newer assistant snapshot when it extends the previous one around tools", () => {
    const messages: PreviewMessage[] = [
      { role: "assistant", text: "__streaming__run-1__第一段", parts: [{ kind: "text", text: "第一段" }], timestamp: 1 },
      { role: "assistant", text: "run-1:exec", parts: [{ kind: "tool_call", tool: "exec" }], timestamp: 2 },
      { role: "assistant", text: "__streaming__run-1__第一段，继续分析", parts: [{ kind: "text", text: "第一段，继续分析" }], timestamp: 3 },
    ];

    const state = getConversationDetailState(messages, "assistant", true);

    expect(state.normalizedMessages.map((message) => message.text)).toEqual([
      "run-1:exec",
      "第一段，继续分析",
    ]);
  });

  it("keeps final full assistant text once when it covers earlier snapshots around tools", () => {
    const messages: PreviewMessage[] = [
      { role: "user", text: "分析股票", timestamp: 1 },
      { role: "assistant", text: "先看基本情况。", parts: [{ kind: "text", text: "先看基本情况。" }], timestamp: 2 },
      { role: "assistant", text: "run-1:exec", parts: [{ kind: "tool_call", tool: "exec" }], timestamp: 3 },
      { role: "assistant", text: "先看基本情况。然后看走势。", parts: [{ kind: "text", text: "先看基本情况。然后看走势。" }], timestamp: 4 },
    ];

    const state = getConversationDetailState(messages, "assistant", true);

    expect(state.normalizedMessages.map((message) => message.text)).toEqual([
      "分析股票",
      "run-1:exec",
      "先看基本情况。然后看走势。",
    ]);
  });
});
