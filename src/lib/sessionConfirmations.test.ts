import { describe, expect, it } from "vitest";
import { shouldRunDestructiveAction } from "./sessionConfirmations";

describe("shouldRunDestructiveAction", () => {
  it("skips confirmation when disabled", () => {
    expect(shouldRunDestructiveAction(false, () => false)).toBe(true);
  });

  it("uses confirmation when enabled", () => {
    expect(shouldRunDestructiveAction(true, () => false)).toBe(false);
    expect(shouldRunDestructiveAction(true, () => true)).toBe(true);
  });
});
