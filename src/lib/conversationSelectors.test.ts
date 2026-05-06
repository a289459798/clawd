import { describe, expect, it } from "vitest";
import { conversationMatchesSessionKey } from "./conversationSelectors";
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
