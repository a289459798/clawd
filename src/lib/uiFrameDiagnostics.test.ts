import { describe, expect, it } from "vitest";
import {
  appendSlowFrameEntry,
  formatDiagnosticAgeCn,
  slowFrameKindLabel,
  type UiSlowFrameEntry,
} from "./uiFrameDiagnostics";

function entry(id: string, ts = 0): UiSlowFrameEntry {
  return { id, ts, durationMs: 50, kind: "longtask" };
}

describe("appendSlowFrameEntry", () => {
  it("prepends and truncates", () => {
    const a = appendSlowFrameEntry([], entry("1"), 3);
    expect(a.map((e) => e.id)).toEqual(["1"]);
    const b = appendSlowFrameEntry(a, entry("2"), 3);
    expect(b.map((e) => e.id)).toEqual(["2", "1"]);
    const c = appendSlowFrameEntry(b, entry("3"), 3);
    expect(c.map((e) => e.id)).toEqual(["3", "2", "1"]);
    const d = appendSlowFrameEntry(c, entry("4"), 3);
    expect(d.map((e) => e.id)).toEqual(["4", "3", "2"]);
  });
});

describe("formatDiagnosticAgeCn", () => {
  it("covers common buckets", () => {
    expect(formatDiagnosticAgeCn(-1)).toBe("-");
    expect(formatDiagnosticAgeCn(10_000)).toBe("刚刚");
    expect(formatDiagnosticAgeCn(60_000)).toBe("1 分钟前");
    expect(formatDiagnosticAgeCn(3600_000)).toBe("1 小时前");
    expect(formatDiagnosticAgeCn(49 * 3600_000)).toMatch(/^2 天前$/);
  });
});

describe("slowFrameKindLabel", () => {
  it("maps kinds", () => {
    expect(slowFrameKindLabel("long-animation-frame")).toBe("慢动画帧");
    expect(slowFrameKindLabel("longtask")).toBe("长任务");
  });
});
