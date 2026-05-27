import { describe, expect, it, vi } from "vitest";
import { buildNotificationId, extractConversationIdFromNotificationAction, sendClawKitNotification } from "./notifications";

describe("sendClawKitNotification", () => {
  it("requests permission when needed before sending", async () => {
    const deps = {
      isPermissionGranted: vi.fn().mockResolvedValue(false),
      requestPermission: vi.fn().mockResolvedValue("granted"),
      sendNotification: vi.fn(),
    };

    const sent = await sendClawKitNotification(deps, {
      title: "完成",
      body: "对话已完成",
    });

    expect(sent).toBe(true);
    expect(deps.requestPermission).toHaveBeenCalledTimes(1);
    expect(deps.sendNotification).toHaveBeenCalledWith({ title: "完成", body: "对话已完成" });
  });

  it("does not send when permission is denied", async () => {
    const deps = {
      isPermissionGranted: vi.fn().mockResolvedValue(false),
      requestPermission: vi.fn().mockResolvedValue("denied"),
      sendNotification: vi.fn(),
    };

    await expect(sendClawKitNotification(deps, { title: "完成", body: "对话已完成" })).resolves.toBe(false);
    expect(deps.sendNotification).not.toHaveBeenCalled();
  });

  it("sends conversation metadata for click handling", async () => {
    const deps = {
      isPermissionGranted: vi.fn().mockResolvedValue(true),
      requestPermission: vi.fn(),
      sendNotification: vi.fn(),
    };

    await sendClawKitNotification(deps, {
      key: "conversation-a:run-1:123",
      title: "完成",
      body: "对话已完成",
      conversationId: "conversation-a",
    });

    expect(deps.sendNotification).toHaveBeenCalledWith({
      id: buildNotificationId("conversation-a:run-1:123"),
      title: "完成",
      body: "对话已完成",
      autoCancel: true,
      extra: {
        kind: "conversationFinished",
        conversationId: "conversation-a",
        key: "conversation-a:run-1:123",
      },
    });
  });
});

describe("extractConversationIdFromNotificationAction", () => {
  it("reads a conversation id from notification extra payload", () => {
    expect(extractConversationIdFromNotificationAction({ extra: { conversationId: "conversation-a" } })).toBe("conversation-a");
  });

  it("ignores missing or blank conversation ids", () => {
    expect(extractConversationIdFromNotificationAction({ extra: { conversationId: " " } })).toBeNull();
    expect(extractConversationIdFromNotificationAction({ extra: {} })).toBeNull();
  });
});
