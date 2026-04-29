import { describe, expect, it } from "vitest";
import { mergeSnapshotMessagesPreservingCurrentOrder } from "./toolStream";
import type { PreviewMessage } from "../types/conversation";

describe("mergeSnapshotMessagesPreservingCurrentOrder", () => {
  it("keeps optimistic local messages when gateway history is stale", () => {
    const previousUser: PreviewMessage = { role: "user", text: "上一条问题", timestamp: 1 };
    const optimisticUser: PreviewMessage = { role: "user", text: "刚发送的问题" };

    expect(mergeSnapshotMessagesPreservingCurrentOrder([previousUser, optimisticUser], [previousUser])).toEqual([
      previousUser,
      optimisticUser,
    ]);
  });

  it("keeps full thread when snapshot payload is only the latest turn", () => {
    const full: PreviewMessage[] = [
      { role: "user", text: "旧问题", timestamp: 1 },
      { role: "assistant", text: "旧回复", timestamp: 2 },
      { role: "user", text: "新问题", timestamp: 3 },
      { role: "assistant", text: "新回复", timestamp: 4 },
    ];
    const gatewayWindow: PreviewMessage[] = [
      { role: "user", text: "新问题", timestamp: 3 },
      { role: "assistant", text: "新回复", timestamp: 4 },
    ];
    expect(mergeSnapshotMessagesPreservingCurrentOrder(full, gatewayWindow)).toEqual(full);
  });
});
