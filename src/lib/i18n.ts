import { enUS } from "../locales/en-US";
import { frFR } from "../locales/fr-FR";
import { jaJP } from "../locales/ja-JP";
import { ruRU } from "../locales/ru-RU";
import { zhCN } from "../locales/zh-CN";
import { zhTW } from "../locales/zh-TW";
import type { ClawKitLanguage } from "../types/settings";

export type Locale = "zh-CN" | "zh-TW" | "en-US" | "ja-JP" | "fr-FR" | "ru-RU";
export type TranslationKey = keyof typeof zhCN;

const dictionaries: Record<Locale, Record<string, string>> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  "en-US": enUS,
  "ja-JP": jaJP,
  "fr-FR": frFR,
  "ru-RU": ruRU,
};

export function resolveLocale(setting: ClawKitLanguage, systemLanguage?: string | null): Locale {
  if (setting !== "auto") return setting;
  const normalized = (systemLanguage ?? "").toLowerCase();
  if (normalized.startsWith("zh-tw") || normalized.startsWith("zh-hk") || normalized.startsWith("zh-hant")) return "zh-TW";
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized.startsWith("ja")) return "ja-JP";
  if (normalized.startsWith("fr")) return "fr-FR";
  if (normalized.startsWith("ru")) return "ru-RU";
  if (normalized.startsWith("en")) return "en-US";
  return "en-US";
}

export function createTranslator(locale: Locale) {
  return (key: string): string => dictionaries[locale][key] ?? dictionaries["zh-CN"][key] ?? key;
}
