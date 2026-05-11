import { describe, expect, it } from "vitest";
import {
  compareOpenClawCalendarCoreVersion,
  isOpenClawCliBelowRecommended,
  MIN_OPENCLAW_CLI_VERSION_SKILL_ZIP_UPLOAD,
  openClawCliMeetsMinimum,
  RECOMMENDED_OPENCLAW_CLI_VERSION,
} from "./openClawVersion";

describe("openClawVersion", () => {
  it("treats prereleases as same calendar core", () => {
    expect(compareOpenClawCalendarCoreVersion("2026.5.10-beta.1", "2026.5.10")).toBe(0);
  });

  it("orders minor segments numerically", () => {
    expect(compareOpenClawCalendarCoreVersion("2026.5.9", "2026.5.10")).toBeLessThan(0);
    expect(compareOpenClawCalendarCoreVersion("2026.5.11", RECOMMENDED_OPENCLAW_CLI_VERSION)).toBeGreaterThan(0);
  });

  it("detects below recommended", () => {
    expect(isOpenClawCliBelowRecommended("2026.5.7")).toBe(true);
    expect(isOpenClawCliBelowRecommended("2026.5.10")).toBe(false);
    expect(isOpenClawCliBelowRecommended("2026.5.10-beta.1")).toBe(false);
    expect(isOpenClawCliBelowRecommended(undefined)).toBe(false);
  });

  it("openClawCliMeetsMinimum follows calendar core ordering", () => {
    expect(openClawCliMeetsMinimum("2026.5.9", MIN_OPENCLAW_CLI_VERSION_SKILL_ZIP_UPLOAD)).toBe(false);
    expect(openClawCliMeetsMinimum("2026.5.10", MIN_OPENCLAW_CLI_VERSION_SKILL_ZIP_UPLOAD)).toBe(true);
    expect(openClawCliMeetsMinimum("2026.5.10-beta.1", MIN_OPENCLAW_CLI_VERSION_SKILL_ZIP_UPLOAD)).toBe(true);
    expect(openClawCliMeetsMinimum(undefined, MIN_OPENCLAW_CLI_VERSION_SKILL_ZIP_UPLOAD)).toBe(false);
  });
});
