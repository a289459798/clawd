import { describe, expect, it } from "vitest";
import { resolveGatewayChannelStatusIds } from "./gatewayChannelStatusIds";

describe("resolveGatewayChannelStatusIds", () => {
  it("merges channelOrder with channels keys when order omits a channel", () => {
    const ids = resolveGatewayChannelStatusIds({
      channelOrder: ["discord", "telegram"],
      channels: {
        discord: {},
        telegram: {},
        qqbot: { configured: false },
      },
      channelAccounts: {
        discord: [],
        telegram: [],
        qqbot: [{ accountId: "default", configured: false }],
      },
    });
    expect(ids).toContain("qqbot");
    expect(ids.indexOf("discord")).toBeLessThan(ids.indexOf("qqbot"));
  });

  it("falls back to channel keys when channelOrder is empty", () => {
    expect(
      resolveGatewayChannelStatusIds({
        channelOrder: [],
        channels: { qqbot: {} },
        channelAccounts: {},
      }),
    ).toEqual(["qqbot"]);
  });
});
