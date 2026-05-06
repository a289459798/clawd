import { describe, expect, it } from "vitest";
import {
  describeUpdateRestartSentinel,
  extrapolateGatewayUptimeMs,
  formatApproxDurationMs,
} from "./gatewayRuntimeInfo";

describe("formatApproxDurationMs", () => {
  it("formats seconds and minutes", () => {
    expect(formatApproxDurationMs(800)).toBe("0 秒");
    expect(formatApproxDurationMs(45_000)).toBe("45 秒");
    expect(formatApproxDurationMs(125_000)).toBe("2 分钟");
  });

  it("formats hours and days", () => {
    expect(formatApproxDurationMs(3_700_000)).toBe("1 小时 1 分");
    expect(formatApproxDurationMs(50 * 3600 * 1000)).toMatch(/天/);
  });
});

describe("extrapolateGatewayUptimeMs", () => {
  it("adds elapsed wall time since handshake", () => {
    expect(
      extrapolateGatewayUptimeMs({
        basisMs: 60_000,
        recordedAtMs: 1000,
        nowMs: 4000,
      }),
    ).toBe(63_000);
  });

  it("returns null when basis missing", () => {
    expect(extrapolateGatewayUptimeMs({ basisMs: null, recordedAtMs: 1 })).toBeNull();
  });
});

describe("describeUpdateRestartSentinel", () => {
  it("returns null for empty/null", () => {
    expect(describeUpdateRestartSentinel(null)).toBeNull();
    expect(describeUpdateRestartSentinel(undefined)).toBeNull();
  });

  it("describes successful update with version", () => {
    const line = describeUpdateRestartSentinel(
      {
        kind: "update",
        status: "ok",
        ts: 40_000,
        stats: { after: { version: "2.0.0" } },
      },
      100_000,
    );
    expect(line).toContain("更新重启已成功");
    expect(line).toContain("2.0.0");
  });
});
