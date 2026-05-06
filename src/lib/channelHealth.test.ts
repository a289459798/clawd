import { describe, expect, it } from "vitest";
import {
  accountOperationalHealthHint,
  formatGatewayEventLoopReason,
  formatGatewayEventLoopSummary,
  resolveChannelOperationalDegraded,
} from "./channelHealth";

describe("channelHealth", () => {
  it("detects operational degradation when running with stale-socket", () => {
    const accounts = [{ running: true, connected: true, healthState: "stale-socket" }];
    expect(resolveChannelOperationalDegraded(accounts)).toBe(true);
    expect(accountOperationalHealthHint(accounts[0])).toBe("传输层长时间无活动");
  });

  it("skips inactive accounts", () => {
    expect(accountOperationalHealthHint({ running: false, connected: false, healthState: "stuck" })).toBeUndefined();
  });

  it("formats known event-loop reasons", () => {
    expect(formatGatewayEventLoopReason("event_loop_delay")).toContain("滞后");
    expect(formatGatewayEventLoopSummary({ degraded: true, reasons: ["event_loop_delay"] })).toContain("滞后");
  });
});
