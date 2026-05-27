import { describe, expect, it } from "vitest";
import { conversationMatchesSessionKey, getVisibleConversations, isSystemAutoConversation } from "./conversationSelectors";
import type { Agent } from "../types/app";
import type { Conversation } from "../types/conversation";

const baseConversation = (): Conversation => ({
  id: "canonical:key",
  title: "t",
  channel: undefined,
  status: "idle",
  lastMessage: "",
  lastTime: "",
  tokens: "0",
  model: "m",
  workspace: "",
  visible: true,
});

describe("conversationMatchesSessionKey", () => {
  it("matches canonical id", () => {
    expect(conversationMatchesSessionKey(baseConversation(), "canonical:key")).toBe(true);
  });

  it("matches listed aliases", () => {
    const c = { ...baseConversation(), alternateSessionKeys: ["alias-main"] };
    expect(conversationMatchesSessionKey(c, "alias-main")).toBe(true);
    expect(conversationMatchesSessionKey(c, "other")).toBe(false);
  });
});

describe("system-created conversation visibility", () => {
  it("detects cron and dreaming sessions from canonical keys", () => {
    expect(isSystemAutoConversation({ ...baseConversation(), id: "agent:main:cron:123" })).toBe(true);
    expect(isSystemAutoConversation({ ...baseConversation(), id: "agent:main:dreaming:123" })).toBe(true);
    expect(isSystemAutoConversation({ ...baseConversation(), id: "agent:main:dreaming-narrative-light-abc" })).toBe(true);
    expect(isSystemAutoConversation({ ...baseConversation(), id: "agent:main:heartbeat" })).toBe(true);
    expect(isSystemAutoConversation({ ...baseConversation(), id: "agent:main:direct:123" })).toBe(false);
  });

  it("hides system-created sessions by default and can show them when enabled", () => {
    const agents: Agent[] = [{
      id: "main",
      name: "Main",
      color: "#fff",
      status: "idle",
      model: "m",
      mdFile: "",
      configPath: "",
      summary: "",
      conversations: [
        { ...baseConversation(), id: "agent:main:direct:1", title: "User chat" },
        { ...baseConversation(), id: "agent:main:cron:2", title: "Cron job" },
        { ...baseConversation(), id: "agent:main:dreaming-narrative-rem-3", title: "Dreaming" },
      ],
    }];

    expect(getVisibleConversations(agents).map((conversation) => conversation.id)).toEqual(["agent:main:direct:1"]);
    expect(getVisibleConversations(agents, { showSystemConversations: true }).map((conversation) => conversation.id)).toEqual([
      "agent:main:direct:1",
      "agent:main:cron:2",
      "agent:main:dreaming-narrative-rem-3",
    ]);
  });
});
