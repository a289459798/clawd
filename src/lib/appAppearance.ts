import type { CSSProperties } from "react";
import type { AppearanceSettings } from "../types/settings";

export function buildAppearanceDataAttributes(appearance: AppearanceSettings, systemTheme: "light" | "dark" = "dark") {
  const resolvedTheme = appearance.theme === "system" ? systemTheme : appearance.theme;
  return {
    "data-theme": resolvedTheme,
    style: {
      "--app-font-size": `${appearance.fontSize}px`,
    } as CSSProperties,
    "data-density": appearance.density,
    "data-message-width": appearance.messageWidth,
    "data-code-wrap": String(appearance.codeWrap),
  };
}
