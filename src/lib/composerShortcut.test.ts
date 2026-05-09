import { describe, expect, it } from "vitest";
import { shouldSubmitComposer } from "./composerShortcut";

describe("shouldSubmitComposer", () => {
  it("uses Enter to send when configured", () => {
    expect(shouldSubmitComposer("enterToSend", { key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false })).toBe(true);
    expect(shouldSubmitComposer("enterToSend", { key: "Enter", shiftKey: true, metaKey: false, ctrlKey: false })).toBe(false);
  });

  it("uses command/control enter when configured", () => {
    expect(shouldSubmitComposer("modEnterToSend", { key: "Enter", shiftKey: false, metaKey: true, ctrlKey: false })).toBe(true);
    expect(shouldSubmitComposer("modEnterToSend", { key: "Enter", shiftKey: false, metaKey: false, ctrlKey: true })).toBe(true);
    expect(shouldSubmitComposer("modEnterToSend", { key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false })).toBe(false);
  });
});
