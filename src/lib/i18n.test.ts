import { describe, expect, it } from "vitest";
import { createTranslator, resolveLocale } from "./i18n";

describe("resolveLocale", () => {
  it("uses explicit supported language before system language", () => {
    expect(resolveLocale("en-US", "zh-CN")).toBe("en-US");
  });

  it("resolves auto from system language and falls back to en-US", () => {
    expect(resolveLocale("auto", "en-GB")).toBe("en-US");
    expect(resolveLocale("auto", "zh-Hant-HK")).toBe("zh-TW");
    expect(resolveLocale("auto", "ja-JP")).toBe("ja-JP");
    expect(resolveLocale("auto", "fr-FR")).toBe("fr-FR");
    expect(resolveLocale("auto", "ru-RU")).toBe("ru-RU");
    expect(resolveLocale("auto", "es-ES")).toBe("en-US");
  });
});

describe("createTranslator", () => {
  it("returns translated strings with zh-CN fallback", () => {
    const t = createTranslator("en-US");
    expect(t("nav.settings")).toBe("Settings");
    expect(t("settings.openclaw.repairBinding")).toBe("Repair binding");
    expect(t("missing.key")).toBe("missing.key");
  });
});
