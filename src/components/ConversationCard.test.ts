import { describe, expect, it } from "vitest";
import { getLabelTypeFromKey } from "./ConversationCard";

describe("getLabelTypeFromKey", () => {
  const t = (key: string) => {
    const map: Record<string, string> = {
      "nav.cron": "定时任务",
      "settings.option.conversation": "对话",
    };
    return map[key] ?? key;
  };
  it("uses the session key segment instead of the title", () => {
    expect(getLabelTypeFromKey(t, "agent:master:cron:830d").text).toBe("定时任务");
    expect(getLabelTypeFromKey(t, "agent:master:dashboard:abc").text).toBe("ClawKit");
    expect(getLabelTypeFromKey(t, "agent:master:direct:abc").text).toBe("对话");
  });
});
