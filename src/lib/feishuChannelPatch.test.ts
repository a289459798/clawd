import { describe, expect, it } from "vitest";
import {
  buildFeishuSettingsPatch,
  emptyFeishuEditorForm,
  readFeishuEditorFormFromConfig,
  validateFeishuEditorForm,
} from "./feishuChannelPatch";

describe("feishuChannelPatch", () => {
  it("reads defaults from config", () => {
    const form = readFeishuEditorFormFromConfig({
      channels: {
        feishu: {
          defaultAccount: "main",
          dmPolicy: "open",
          groupPolicy: "allowlist",
          requireMention: false,
          accounts: {
            main: { appId: "cli_xxx", name: "Main", enabled: true },
          },
        },
      },
    });
    expect(form.defaultAccount).toBe("main");
    expect(form.dmPolicy).toBe("open");
    expect(form.requireMention).toBe(false);
    expect(form.accounts[0]?.accountId).toBe("main");
  });

  it("builds patch with accounts and policies", () => {
    const form = emptyFeishuEditorForm();
    form.defaultAccount = "main";
    form.dmPolicy = "allowlist";
    form.groupPolicy = "open";
    form.requireMention = false;
    form.allowFromLines = "ou_1\nou_2";
    form.groupAllowFromLines = "oc_a";
    form.accounts = [{ accountId: "main", name: "Primary", enabled: true, appId: "cli_1", appSecret: "sec_1" }];

    expect(buildFeishuSettingsPatch(form)).toEqual({
      channels: {
        feishu: {
          enabled: true,
          domain: "feishu",
          connectionMode: "websocket",
          defaultAccount: "main",
          dmPolicy: "allowlist",
          groupPolicy: "open",
          requireMention: false,
          allowFrom: ["ou_1", "ou_2"],
          groupAllowFrom: ["oc_a"],
          accounts: {
            main: {
              enabled: true,
              name: "Primary",
              appId: "cli_1",
              appSecret: "sec_1",
            },
          },
        },
      },
    });
  });

  it("validates account rows", () => {
    const form = emptyFeishuEditorForm();
    form.accounts = [{ accountId: "", name: "", enabled: true, appId: "", appSecret: "x" }];
    expect(validateFeishuEditorForm(form)).toContain("账号 ID");
  });
});

