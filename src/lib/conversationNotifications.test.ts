import { describe, expect, it } from "vitest";
import { buildConversationCompletionNotification } from "./conversationNotifications";
import { DEFAULT_CLAWKIT_SETTINGS } from "./settingsDefaults";
import type { Conversation } from "../types/conversation";

const baseConversation: Conversation = {
  id: "agent:main:direct:one",
  title: "Plan review",
  status: "working",
  lastMessage: "",
  lastTime: "",
  tokens: "-",
  model: "gpt-5.5",
  workspace: "",
  visible: true,
  runtime: { activeRunId: "run-1", activeStartedAt: 1000, lastEventAt: 1000 },
};

describe("buildConversationCompletionNotification", () => {
  it("notifies when a working run completes", () => {
    const seen = new Set<string>();
    const notification = buildConversationCompletionNotification({
      previous: baseConversation,
      current: {
        ...baseConversation,
        status: "completed",
        runtime: { lastRunStartedAt: 1000, lastTerminalAt: 2000, lastTerminalReason: "completed" },
        previewMessages: [{ role: "assistant", text: "完成了设置页面的接入。" }],
      },
      settings: DEFAULT_CLAWKIT_SETTINGS.notifications,
      windowFocused: false,
      seenKeys: seen,
    });

    expect(notification).toEqual({
      key: "agent:main:direct:one:run-1:2000",
      title: "Plan review",
      body: "完成了设置页面的接入。",
    });
    expect(seen.has("agent:main:direct:one:run-1:2000")).toBe(true);
  });

  it("suppresses startup-loaded terminal conversations", () => {
    expect(buildConversationCompletionNotification({
      previous: null,
      current: { ...baseConversation, status: "completed" },
      settings: DEFAULT_CLAWKIT_SETTINGS.notifications,
      windowFocused: false,
      seenKeys: new Set(),
    })).toBeNull();
  });

  it("respects privacy mode and no duplicate keys", () => {
    const seen = new Set<string>();
    const current: Conversation = {
      ...baseConversation,
      status: "failed",
      runtime: { lastTerminalAt: 2000, lastTerminalReason: "failed" },
      lastMessage: "stack trace detail",
    };
    const settings = {
      ...DEFAULT_CLAWKIT_SETTINGS.notifications,
      privacyMode: true,
    };

    expect(buildConversationCompletionNotification({
      previous: baseConversation,
      current,
      settings,
      windowFocused: false,
      seenKeys: seen,
    })?.body).toBe("对话已结束");
    expect(buildConversationCompletionNotification({
      previous: baseConversation,
      current,
      settings,
      windowFocused: false,
      seenKeys: seen,
    })).toBeNull();
  });
});
