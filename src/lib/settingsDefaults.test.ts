import { describe, expect, it } from "vitest";
import { DEFAULT_CLAWKIT_SETTINGS, mergeClawKitSettings } from "./settingsDefaults";

describe("mergeClawKitSettings", () => {
  it("fills an empty config with defaults", () => {
    expect(mergeClawKitSettings({})).toEqual(DEFAULT_CLAWKIT_SETTINGS);
  });

  it("keeps valid partial settings and fills missing keys", () => {
    const settings = mergeClawKitSettings({
      general: {
        language: "en-US",
        sendShortcut: "enterToSend",
      },
      appearance: {
        theme: "light",
      },
    });

    expect(settings.general.language).toBe("en-US");
    expect(settings.general.sendShortcut).toBe("enterToSend");
    expect(settings.general.defaultConversationMode).toBe("focus");
    expect(settings.general.conversationAutoScrollMode).toBe("nearBottom");
    expect(settings.general.showSystemConversations).toBe(false);
    expect(settings.appearance.theme).toBe("light");
    expect(settings.notifications.conversationFinished).toBe(true);
  });

  it("preserves unknown root and section keys", () => {
    const settings = mergeClawKitSettings({
      experimentalRoot: "keep",
      general: {
        unknownGeneral: 42,
      },
      notifications: {
        futureSetting: "later",
      },
    });

    expect(settings.experimentalRoot).toBe("keep");
    expect(settings.general.unknownGeneral).toBe(42);
    expect(settings.notifications.futureSetting).toBe("later");
  });

  it("falls back to defaults for invalid enum and boolean values", () => {
    const settings = mergeClawKitSettings({
      version: "bad",
      general: {
        defaultConversationMode: "immersive",
        conversationAutoScrollMode: "teleport",
        language: "es-ES",
        sendShortcut: "spaceToSend",
        restoreLastConversation: "yes",
        showSystemConversations: "yes",
      },
      appearance: {
        theme: "blue",
        fontSize: "huge",
        density: "packed",
        messageWidth: "full",
        codeWrap: "false",
      },
    });

    expect(settings.version).toBe(1);
    expect(settings.general.defaultConversationMode).toBe("focus");
    expect(settings.general.conversationAutoScrollMode).toBe("nearBottom");
    expect(settings.general.language).toBe("auto");
    expect(settings.general.sendShortcut).toBe("enterToSend");
    expect(settings.general.restoreLastConversation).toBe(false);
    expect(settings.general.showSystemConversations).toBe(false);
    expect(settings.appearance.theme).toBe("system");
    expect(settings.appearance.fontSize).toBe(15);
    expect(settings.appearance.density).toBe("comfortable");
    expect(settings.appearance.messageWidth).toBe("normal");
    expect(settings.appearance.codeWrap).toBe(false);
    expect("advanced" in settings).toBe(false);
  });
});
