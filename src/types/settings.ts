export type DefaultConversationMode = "focus" | "conversation";
export type ConversationAutoScrollMode = "nearBottom" | "always" | "manual";
export type ClawKitLanguage = "auto" | "zh-CN" | "zh-TW" | "en-US" | "ja-JP" | "fr-FR" | "ru-RU";
export type SendShortcut = "enterToSend" | "modEnterToSend";
export type ClawKitTheme = "system" | "dark" | "light";
export type ClawKitDensity = "comfortable" | "compact";
export type MessageWidth = "normal" | "wide";

export type GeneralSettings = {
  defaultConversationMode: DefaultConversationMode;
  conversationAutoScrollMode: ConversationAutoScrollMode;
  language: ClawKitLanguage;
  sendShortcut: SendShortcut;
  restoreLastConversation: boolean;
  rememberConversationFilters: boolean;
  showSystemConversations: boolean;
  autoCheckUpdates: boolean;
  confirmDestructiveActions: boolean;
} & Record<string, unknown>;

export type AppearanceSettings = {
  theme: ClawKitTheme;
  fontSize: number;
  density: ClawKitDensity;
  codeWrap: boolean;
  messageWidth: MessageWidth;
} & Record<string, unknown>;

export type NotificationSettings = {
  conversationFinished: boolean;
  onlyWhenUnfocused: boolean;
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  includeReplySummary: boolean;
  privacyMode: boolean;
} & Record<string, unknown>;

export type OpenClawSettings = {
  autoStartGateway: boolean;
} & Record<string, unknown>;

export type ClawKitSettings = {
  version: number;
  general: GeneralSettings;
  appearance: AppearanceSettings;
  notifications: NotificationSettings;
  openclaw: OpenClawSettings;
} & Record<string, unknown>;

export type ClawKitSettingsPatch = Partial<{
  general: Partial<GeneralSettings>;
  appearance: Partial<AppearanceSettings>;
  notifications: Partial<NotificationSettings>;
  openclaw: Partial<OpenClawSettings>;
}> & Record<string, unknown>;
