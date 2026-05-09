import { describe, expect, it } from "vitest";
import { getLabelTypeFromKey } from "./ConversationCard";

describe("getLabelTypeFromKey", () => {
  it("uses the session key segment instead of the title", () => {
    expect(getLabelTypeFromKey("agent:master:cron:830d").text).toBe("定时任务");
    expect(getLabelTypeFromKey("agent:master:dashboard:abc").text).toBe("ClawKit");
    expect(getLabelTypeFromKey("agent:master:direct:abc").text).toBe("对话");
  });
});
