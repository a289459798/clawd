import { describe, expect, it } from "vitest";
import { buildAppearanceDataAttributes } from "./appAppearance";
import { DEFAULT_CLAWKIT_SETTINGS } from "./settingsDefaults";

describe("buildAppearanceDataAttributes", () => {
  it("maps appearance settings to root data attributes", () => {
    expect(buildAppearanceDataAttributes({
      ...DEFAULT_CLAWKIT_SETTINGS.appearance,
      theme: "light",
      fontSize: 17,
      density: "compact",
      messageWidth: "wide",
      codeWrap: true,
    })).toEqual({
      "data-theme": "light",
      style: { "--app-font-size": "17px" },
      "data-density": "compact",
      "data-message-width": "wide",
      "data-code-wrap": "true",
    });
  });

  it("resolves system theme to the current system appearance", () => {
    expect(buildAppearanceDataAttributes({
      ...DEFAULT_CLAWKIT_SETTINGS.appearance,
      theme: "system",
    }, "light")["data-theme"]).toBe("light");
  });
});
