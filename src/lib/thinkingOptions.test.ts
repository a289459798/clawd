import { describe, expect, it } from "vitest";
import { resolveComposerThinkingOptions } from "./thinkingOptions";
import type { Conversation } from "../types/conversation";

describe("resolveComposerThinkingOptions", () => {
  it("uses session row options when present", () => {
    const conversation: Conversation = {
      id: "s1",
      title: "t",
      status: "idle",
      lastMessage: "",
      lastTime: "",
      tokens: "-",
      model: "m",
      workspace: "",
      visible: true,
      thinkingOptions: [
        { value: "medium", label: "medium" },
        { value: "off", label: "off" },
      ],
    };
    expect(resolveComposerThinkingOptions(conversation, { thinkingLevels: [{ id: "high", label: "high" }] })).toEqual([
      { value: "medium", label: "medium" },
      { value: "off", label: "off" },
    ]);
  });

  it("falls back to Gateway sessions.list defaults thinkingLevels when row has no options", () => {
    const conversation: Conversation = {
      id: "s1",
      title: "t",
      status: "idle",
      lastMessage: "",
      lastTime: "",
      tokens: "-",
      model: "m",
      workspace: "",
      visible: true,
    };
    expect(
      resolveComposerThinkingOptions(conversation, {
        thinkingLevels: [
          { id: "off", label: "off" },
          { id: "medium", label: "medium" },
        ],
      }),
    ).toEqual([
      { value: "off", label: "off" },
      { value: "medium", label: "medium" },
    ]);
  });

  it("returns undefined when neither session nor defaults provide levels", () => {
    expect(resolveComposerThinkingOptions(null, null)).toBeUndefined();
  });
});
