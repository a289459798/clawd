import type {
  AppearanceSettings,
  ClawKitDensity,
  ClawKitLanguage,
  ClawKitSettings,
  ClawKitTheme,
  ConversationAutoScrollMode,
  DefaultConversationMode,
  GeneralSettings,
  MessageWidth,
  NotificationSettings,
  OpenClawSettings,
  SendShortcut,
} from "../types/settings";

export const DEFAULT_CLAWKIT_SETTINGS: ClawKitSettings = {
  version: 1,
  general: {
    defaultConversationMode: "focus",
    conversationAutoScrollMode: "nearBottom",
    language: "auto",
    sendShortcut: "enterToSend",
    restoreLastConversation: false,
    rememberConversationFilters: true,
    showSystemConversations: false,
    autoCheckUpdates: true,
    confirmDestructiveActions: true,
  },
  appearance: {
    theme: "system",
    fontSize: 15,
    density: "comfortable",
    codeWrap: false,
    messageWidth: "normal",
  },
  notifications: {
    conversationFinished: true,
    onlyWhenUnfocused: true,
    notifyOnSuccess: true,
    notifyOnFailure: true,
    includeReplySummary: true,
    privacyMode: false,
  },
  openclaw: {
    autoStartGateway: false,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function boolValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function sectionRecord(raw: Record<string, unknown>, key: string) {
  const value = raw[key];
  return isRecord(value) ? value : {};
}

function mergeGeneral(raw: Record<string, unknown>): GeneralSettings {
  return {
    ...raw,
    defaultConversationMode: enumValue<DefaultConversationMode>(
      raw.defaultConversationMode,
      ["focus", "conversation"],
      DEFAULT_CLAWKIT_SETTINGS.general.defaultConversationMode,
    ),
    conversationAutoScrollMode: enumValue<ConversationAutoScrollMode>(
      raw.conversationAutoScrollMode,
      ["nearBottom", "always", "manual"],
      DEFAULT_CLAWKIT_SETTINGS.general.conversationAutoScrollMode,
    ),
    language: enumValue<ClawKitLanguage>(
      raw.language,
      ["auto", "zh-CN", "zh-TW", "en-US", "ja-JP", "fr-FR", "ru-RU"],
      DEFAULT_CLAWKIT_SETTINGS.general.language,
    ),
    sendShortcut: enumValue<SendShortcut>(
      raw.sendShortcut,
      ["enterToSend", "modEnterToSend"],
      DEFAULT_CLAWKIT_SETTINGS.general.sendShortcut,
    ),
    restoreLastConversation: boolValue(
      raw.restoreLastConversation,
      DEFAULT_CLAWKIT_SETTINGS.general.restoreLastConversation,
    ),
    rememberConversationFilters: boolValue(
      raw.rememberConversationFilters,
      DEFAULT_CLAWKIT_SETTINGS.general.rememberConversationFilters,
    ),
    showSystemConversations: boolValue(
      raw.showSystemConversations,
      DEFAULT_CLAWKIT_SETTINGS.general.showSystemConversations,
    ),
    autoCheckUpdates: boolValue(raw.autoCheckUpdates, DEFAULT_CLAWKIT_SETTINGS.general.autoCheckUpdates),
    confirmDestructiveActions: boolValue(
      raw.confirmDestructiveActions,
      DEFAULT_CLAWKIT_SETTINGS.general.confirmDestructiveActions,
    ),
  };
}

function mergeAppearance(raw: Record<string, unknown>): AppearanceSettings {
  return {
    ...raw,
    theme: enumValue<ClawKitTheme>(raw.theme, ["system", "dark", "light"], DEFAULT_CLAWKIT_SETTINGS.appearance.theme),
    fontSize: numberValue(raw.fontSize, DEFAULT_CLAWKIT_SETTINGS.appearance.fontSize, 12, 20),
    density: enumValue<ClawKitDensity>(
      raw.density,
      ["comfortable", "compact"],
      DEFAULT_CLAWKIT_SETTINGS.appearance.density,
    ),
    codeWrap: boolValue(raw.codeWrap, DEFAULT_CLAWKIT_SETTINGS.appearance.codeWrap),
    messageWidth: enumValue<MessageWidth>(
      raw.messageWidth,
      ["normal", "wide"],
      DEFAULT_CLAWKIT_SETTINGS.appearance.messageWidth,
    ),
  };
}

function mergeNotifications(raw: Record<string, unknown>): NotificationSettings {
  return {
    ...raw,
    conversationFinished: boolValue(
      raw.conversationFinished,
      DEFAULT_CLAWKIT_SETTINGS.notifications.conversationFinished,
    ),
    onlyWhenUnfocused: boolValue(raw.onlyWhenUnfocused, DEFAULT_CLAWKIT_SETTINGS.notifications.onlyWhenUnfocused),
    notifyOnSuccess: boolValue(raw.notifyOnSuccess, DEFAULT_CLAWKIT_SETTINGS.notifications.notifyOnSuccess),
    notifyOnFailure: boolValue(raw.notifyOnFailure, DEFAULT_CLAWKIT_SETTINGS.notifications.notifyOnFailure),
    includeReplySummary: boolValue(
      raw.includeReplySummary,
      DEFAULT_CLAWKIT_SETTINGS.notifications.includeReplySummary,
    ),
    privacyMode: boolValue(raw.privacyMode, DEFAULT_CLAWKIT_SETTINGS.notifications.privacyMode),
  };
}

function mergeOpenClaw(raw: Record<string, unknown>): OpenClawSettings {
  return {
    ...raw,
    autoStartGateway: boolValue(raw.autoStartGateway, DEFAULT_CLAWKIT_SETTINGS.openclaw.autoStartGateway),
  };
}

export function mergeClawKitSettings(raw: unknown): ClawKitSettings {
  const root = isRecord(raw) ? raw : {};
  return {
    ...root,
    version: typeof root.version === "number" && Number.isFinite(root.version) ? root.version : DEFAULT_CLAWKIT_SETTINGS.version,
    general: mergeGeneral(sectionRecord(root, "general")),
    appearance: mergeAppearance(sectionRecord(root, "appearance")),
    notifications: mergeNotifications(sectionRecord(root, "notifications")),
    openclaw: mergeOpenClaw(sectionRecord(root, "openclaw")),
  };
}
