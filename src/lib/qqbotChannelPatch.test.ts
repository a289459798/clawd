import { describe, expect, it } from "vitest";
import {
  buildQqbotSettingsPatch,
  emptyQqbotEditorForm,
  readQqbotEditorFormFromConfig,
  validateQqbotEditorForm,
} from "./qqbotChannelPatch";

describe("buildQqbotSettingsPatch", () => {
  it("writes default credentials", () => {
    const form = emptyQqbotEditorForm();
    form.defaultAppId = "111";
    form.defaultClientSecret = "sec";
    expect(buildQqbotSettingsPatch(form)).toEqual({
      channels: { qqbot: { enabled: true, appId: "111", clientSecret: "sec" } },
    });
  });

  it("writes sub-accounts", () => {
    const form = emptyQqbotEditorForm();
    form.extraAccounts = [{ accountId: "bot2", appId: "222", clientSecret: "s2" }];
    expect(buildQqbotSettingsPatch(form)).toEqual({
      channels: {
        qqbot: {
          enabled: true,
          accounts: { bot2: { enabled: true, appId: "222", clientSecret: "s2" } },
        },
      },
    });
  });

  it("includes group policy when applyGroupSettings", () => {
    const form = emptyQqbotEditorForm();
    form.applyGroupSettings = true;
    form.groupPolicy = "allowlist";
    form.groupAllowFromLines = "a\nb";
    form.groupsStarRequireMention = false;
    form.groupsStarHistoryLimit = "20";
    form.groupsStarToolPolicy = "full";
    expect(buildQqbotSettingsPatch(form)).toEqual({
      channels: {
        qqbot: {
          enabled: true,
          groupPolicy: "allowlist",
          groupAllowFrom: ["a", "b"],
          groups: {
            "*": {
              requireMention: false,
              historyLimit: 20,
              toolPolicy: "full",
            },
          },
        },
      },
    });
  });
});

describe("readQqbotEditorFormFromConfig", () => {
  it("defaults groupPolicy when only groups star is set", () => {
    const form = readQqbotEditorFormFromConfig({
      channels: { qqbot: { groups: { "*": { requireMention: false } } } },
    });
    expect(form.applyGroupSettings).toBe(true);
    expect(form.groupPolicy).toBe("allowlist");
  });

  it("parses nested qqbot config", () => {
    const form = readQqbotEditorFormFromConfig({
      channels: {
        qqbot: {
          appId: "9",
          accounts: { x: { appId: "x1" } },
          groupPolicy: "open",
          groups: { "*": { requireMention: false, historyLimit: 12, toolPolicy: "none" } },
        },
      },
    });
    expect(form.defaultAppId).toBe("9");
    expect(form.extraAccounts).toEqual([{ accountId: "x", appId: "x1", clientSecret: "" }]);
    expect(form.applyGroupSettings).toBe(true);
    expect(form.groupPolicy).toBe("open");
    expect(form.groupsStarRequireMention).toBe(false);
    expect(form.groupsStarHistoryLimit).toBe("12");
    expect(form.groupsStarToolPolicy).toBe("none");
  });
});

describe("validateQqbotEditorForm", () => {
  it("rejects default reserved account id", () => {
    const form = emptyQqbotEditorForm();
    form.extraAccounts = [{ accountId: "default", appId: "1", clientSecret: "s" }];
    expect(validateQqbotEditorForm(form)).toMatch(/default/);
  });

  it("accepts app id only default with group", () => {
    const form = emptyQqbotEditorForm();
    form.defaultAppId = "only";
    form.applyGroupSettings = true;
    form.groupPolicy = "disabled";
    expect(validateQqbotEditorForm(form)).toBeNull();
  });
});
