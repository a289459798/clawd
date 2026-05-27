import {
  isPermissionGranted,
  onAction,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { PluginListener } from "@tauri-apps/api/core";

type NotificationPermissionResult = "granted" | "denied" | "default";

export type NotificationDeps = {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<NotificationPermissionResult>;
  sendNotification: (options: ClawKitNotificationOptions) => void;
};

export type ClawKitNotification = {
  key?: string;
  title: string;
  body?: string;
  conversationId?: string;
};

export type ClawKitNotificationOptions = {
  id?: number;
  title: string;
  body?: string;
  autoCancel?: boolean;
  extra?: Record<string, unknown>;
};

const tauriNotificationDeps: NotificationDeps = {
  isPermissionGranted,
  requestPermission,
  sendNotification,
};

export function buildNotificationId(key: string) {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return Math.abs(hash || 1);
}

export function extractConversationIdFromNotificationAction(notification: { extra?: Record<string, unknown> }) {
  const conversationId = notification.extra?.conversationId;
  return typeof conversationId === "string" && conversationId.trim() ? conversationId : null;
}

function buildNotificationOptions(notification: ClawKitNotification): ClawKitNotificationOptions {
  if (!notification.key || !notification.conversationId) {
    return {
      title: notification.title,
      body: notification.body,
    };
  }
  return {
    id: buildNotificationId(notification.key),
    title: notification.title,
    body: notification.body,
    autoCancel: true,
    extra: {
      kind: "conversationFinished",
      conversationId: notification.conversationId,
      key: notification.key,
    },
  };
}

export async function sendClawKitNotification(
  deps: NotificationDeps,
  notification: ClawKitNotification,
) {
  const alreadyGranted = await deps.isPermissionGranted();
  const granted = alreadyGranted || (await deps.requestPermission()) === "granted";
  if (!granted) return false;
  deps.sendNotification(buildNotificationOptions(notification));
  return true;
}

export async function sendNativeNotification(notification: ClawKitNotification) {
  try {
    return await sendClawKitNotification(tauriNotificationDeps, notification);
  } catch (error) {
    console.warn("Failed to send ClawKit notification", error);
    return false;
  }
}

export async function onNativeNotificationAction(callback: (conversationId: string) => void | Promise<void>): Promise<PluginListener> {
  return onAction((notification) => {
    const conversationId = extractConversationIdFromNotificationAction(notification);
    if (conversationId) {
      void callback(conversationId);
    }
  });
}
