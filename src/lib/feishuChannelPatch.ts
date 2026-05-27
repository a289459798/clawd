type FeishuDomain = "" | "feishu" | "lark";
type FeishuConnectionMode = "" | "websocket" | "webhook";
type FeishuDmPolicy = "" | "pairing" | "allowlist" | "open" | "disabled";
type FeishuGroupPolicy = "" | "allowlist" | "open" | "disabled";

export type FeishuAccountRow = {
  accountId: string;
  name: string;
  enabled: boolean;
  appId: string;
  appSecret: string;
};

export type FeishuEditorForm = {
  defaultAccount: string;
  domain: FeishuDomain;
  connectionMode: FeishuConnectionMode;
  dmPolicy: FeishuDmPolicy;
  allowFromLines: string;
  groupPolicy: FeishuGroupPolicy;
  requireMention: boolean;
  groupAllowFromLines: string;
  accounts: FeishuAccountRow[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function emptyFeishuEditorForm(): FeishuEditorForm {
  return {
    defaultAccount: "default",
    domain: "feishu",
    connectionMode: "websocket",
    dmPolicy: "allowlist",
    allowFromLines: "",
    groupPolicy: "allowlist",
    requireMention: true,
    groupAllowFromLines: "",
    accounts: [{ accountId: "default", name: "", enabled: true, appId: "", appSecret: "" }],
  };
}

export function readFeishuEditorFormFromConfig(config: unknown): FeishuEditorForm {
  const out = emptyFeishuEditorForm();
  const root = asRecord(config);
  const channels = asRecord(root?.channels);
  const feishu = asRecord(channels?.feishu);
  if (!feishu) return out;

  if (typeof feishu.defaultAccount === "string" && feishu.defaultAccount.trim()) {
    out.defaultAccount = feishu.defaultAccount.trim();
  }
  if (feishu.domain === "feishu" || feishu.domain === "lark") out.domain = feishu.domain;
  if (feishu.connectionMode === "websocket" || feishu.connectionMode === "webhook") out.connectionMode = feishu.connectionMode;
  if (
    feishu.dmPolicy === "pairing" ||
    feishu.dmPolicy === "allowlist" ||
    feishu.dmPolicy === "open" ||
    feishu.dmPolicy === "disabled"
  ) out.dmPolicy = feishu.dmPolicy;
  if (
    feishu.groupPolicy === "allowlist" ||
    feishu.groupPolicy === "open" ||
    feishu.groupPolicy === "disabled"
  ) out.groupPolicy = feishu.groupPolicy;
  if (typeof feishu.requireMention === "boolean") out.requireMention = feishu.requireMention;

  if (Array.isArray(feishu.allowFrom)) {
    out.allowFromLines = feishu.allowFrom.map((v) => String(v).trim()).filter(Boolean).join("\n");
  }
  if (Array.isArray(feishu.groupAllowFrom)) {
    out.groupAllowFromLines = feishu.groupAllowFrom.map((v) => String(v).trim()).filter(Boolean).join("\n");
  }

  const accounts = asRecord(feishu.accounts);
  if (accounts) {
    out.accounts = Object.entries(accounts).map(([accountId, raw]) => {
      const row = asRecord(raw);
      return {
        accountId,
        name: typeof row?.name === "string" ? row.name : "",
        enabled: typeof row?.enabled === "boolean" ? row.enabled : true,
        appId: typeof row?.appId === "string" ? row.appId : "",
        appSecret: "",
      };
    });
  }

  if (out.accounts.length === 0) {
    out.accounts = [{ accountId: out.defaultAccount || "default", name: "", enabled: true, appId: "", appSecret: "" }];
  }
  return out;
}

export function validateFeishuEditorForm(form: FeishuEditorForm): string | null {
  if (!form.defaultAccount.trim()) return "请填写默认账号 ID。";
  if (!form.dmPolicy) return "请选择私聊策略。";
  if (!form.groupPolicy) return "请选择群聊策略。";
  for (const row of form.accounts) {
    const id = row.accountId.trim();
    const appId = row.appId.trim();
    const secret = row.appSecret.trim();
    const name = row.name.trim();
    if (!id && !appId && !secret && !name) continue;
    if (!id) return "账号行已填写内容时，必须填写账号 ID。";
    if (!appId && secret) return "填写应用密钥时，请同时填写应用 ID。";
  }
  return null;
}

function splitLines(value: string): string[] {
  return value.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
}

export function buildFeishuSettingsPatch(form: FeishuEditorForm): { channels: { feishu: Record<string, unknown> } } {
  const feishu: Record<string, unknown> = {
    enabled: true,
    defaultAccount: form.defaultAccount.trim() || "default",
    dmPolicy: form.dmPolicy || "allowlist",
    groupPolicy: form.groupPolicy || "allowlist",
    requireMention: form.requireMention,
  };

  if (form.domain) feishu.domain = form.domain;
  if (form.connectionMode) feishu.connectionMode = form.connectionMode;

  const allowFrom = splitLines(form.allowFromLines);
  if (allowFrom.length) feishu.allowFrom = allowFrom;
  const groupAllowFrom = splitLines(form.groupAllowFromLines);
  if (groupAllowFrom.length) feishu.groupAllowFrom = groupAllowFrom;

  const accounts: Record<string, unknown> = {};
  for (const row of form.accounts) {
    const id = row.accountId.trim();
    if (!id) continue;
    const appId = row.appId.trim();
    const appSecret = row.appSecret.trim();
    const item: Record<string, unknown> = { enabled: row.enabled };
    if (row.name.trim()) item.name = row.name.trim();
    if (appId) item.appId = appId;
    if (appSecret) item.appSecret = appSecret;
    accounts[id] = item;
  }
  if (Object.keys(accounts).length) feishu.accounts = accounts;

  return { channels: { feishu } };
}

