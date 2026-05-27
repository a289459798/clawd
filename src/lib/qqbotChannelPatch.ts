/** Helpers for OpenClaw `config.patch` → `channels.qqbot` (https://docs.openclaw.ai/channels/qqbot). */

export type QqbotExtraAccountRow = {
  accountId: string;
  appId: string;
  clientSecret: string;
};

export type QqbotEditorForm = {
  defaultAppId: string;
  defaultClientSecret: string;
  extraAccounts: QqbotExtraAccountRow[];
  /** When true, patch includes groupPolicy / groupAllowFrom / groups["*"]. */
  applyGroupSettings: boolean;
  groupPolicy: "" | "allowlist" | "open" | "disabled";
  /** One OpenID / member id per line (for groupAllowFrom). */
  groupAllowFromLines: string;
  groupsStarRequireMention: boolean;
  groupsStarHistoryLimit: string;
  groupsStarToolPolicy: "" | "full" | "restricted" | "none";
};

export function emptyQqbotEditorForm(): QqbotEditorForm {
  return {
    defaultAppId: "",
    defaultClientSecret: "",
    extraAccounts: [],
    applyGroupSettings: false,
    groupPolicy: "",
    groupAllowFromLines: "",
    groupsStarRequireMention: true,
    groupsStarHistoryLimit: "50",
    groupsStarToolPolicy: "restricted",
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function readQqbotEditorFormFromConfig(config: unknown): QqbotEditorForm {
  const out = emptyQqbotEditorForm();
  const root = asRecord(config);
  const channels = asRecord(root?.channels);
  const q = asRecord(channels?.qqbot);
  if (!q) return out;

  if (typeof q.appId === "string") out.defaultAppId = q.appId.trim();

  const accounts = asRecord(q.accounts);
  if (accounts) {
    for (const [accountId, raw] of Object.entries(accounts)) {
      const acc = asRecord(raw);
      out.extraAccounts.push({
        accountId,
        appId: typeof acc?.appId === "string" ? acc.appId.trim() : "",
        clientSecret: "",
      });
    }
  }

  if (typeof q.groupPolicy === "string" && (q.groupPolicy === "allowlist" || q.groupPolicy === "open" || q.groupPolicy === "disabled")) {
    out.applyGroupSettings = true;
    out.groupPolicy = q.groupPolicy;
  }
  const allow = q.groupAllowFrom;
  if (Array.isArray(allow)) {
    out.applyGroupSettings = true;
    out.groupAllowFromLines = allow.map((item) => String(item).trim()).filter(Boolean).join("\n");
  }

  const groups = asRecord(q.groups);
  const star = asRecord(groups?.["*"]);
  if (star) {
    out.applyGroupSettings = true;
    if (typeof star.requireMention === "boolean") out.groupsStarRequireMention = star.requireMention;
    if (typeof star.historyLimit === "number" && Number.isFinite(star.historyLimit)) {
      out.groupsStarHistoryLimit = String(star.historyLimit);
    }
    const tp = star.toolPolicy;
    if (tp === "full" || tp === "restricted" || tp === "none") {
      out.groupsStarToolPolicy = tp;
    }
  }

  if (out.applyGroupSettings && !out.groupPolicy) {
    out.groupPolicy = "allowlist";
  }

  return out;
}

export function validateQqbotEditorForm(form: QqbotEditorForm): string | null {
  for (const row of form.extraAccounts) {
    const id = row.accountId.trim();
    const aid = row.appId.trim();
    const sec = row.clientSecret.trim();
    if (!id && !aid && !sec) continue;
    if (id === "default") return "子账号的账号 ID 不能使用 reserved 名称 default。";
    if (!id || !aid) return "已填写的子账号行需要同时填写「账号 ID」与「AppID」。";
  }

  const hasSecretDefault = Boolean(form.defaultAppId.trim()) && Boolean(form.defaultClientSecret.trim());
  const hasAppIdOnlyDefault = Boolean(form.defaultAppId.trim()) && !form.defaultClientSecret.trim();
  const hasSecretOnlyDefault = !form.defaultAppId.trim() && Boolean(form.defaultClientSecret.trim());
  if (hasSecretOnlyDefault) return "填写了主账号 Client Secret 时请同时填写 AppID。";

  const extrasForPatch = form.extraAccounts.filter((row) => {
    const id = row.accountId.trim();
    const aid = row.appId.trim();
    return Boolean(id && aid);
  });

  const hasGroup = form.applyGroupSettings && Boolean(form.groupPolicy);
  const hasDefaultTouch = Boolean(form.defaultAppId.trim()) || Boolean(form.defaultClientSecret.trim());
  if (!hasSecretDefault && !hasAppIdOnlyDefault && !hasDefaultTouch && extrasForPatch.length === 0 && !hasGroup) {
    return "请至少配置一项：主账号、子账号（账号 ID + AppID，Secret 可留空以保留原密钥），或启用群聊策略。";
  }

  if (form.applyGroupSettings && !form.groupPolicy) {
    return "已勾选「应用群聊策略」时，请选择 groupPolicy（allowlist / open / disabled）。";
  }

  return null;
}

export function buildQqbotSettingsPatch(form: QqbotEditorForm): { channels: { qqbot: Record<string, unknown> } } {
  const qqbot: Record<string, unknown> = { enabled: true };

  const appId = form.defaultAppId.trim();
  const secret = form.defaultClientSecret.trim();
  if (appId) qqbot.appId = appId;
  if (secret) qqbot.clientSecret = secret;

  const accounts: Record<string, unknown> = {};
  for (const row of form.extraAccounts) {
    const id = row.accountId.trim();
    const aid = row.appId.trim();
    const sec = row.clientSecret.trim();
    if (!id || !aid) continue;
    if (id === "default") continue;
    const acc: Record<string, unknown> = { enabled: true, appId: aid };
    if (sec) acc.clientSecret = sec;
    accounts[id] = acc;
  }
  if (Object.keys(accounts).length > 0) {
    qqbot.accounts = accounts;
  }

  if (form.applyGroupSettings && form.groupPolicy) {
    qqbot.groupPolicy = form.groupPolicy;
    const lines = form.groupAllowFromLines
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 0) {
      qqbot.groupAllowFrom = lines;
    }
    const star: Record<string, unknown> = {
      requireMention: form.groupsStarRequireMention,
    };
    const hl = Number.parseInt(form.groupsStarHistoryLimit, 10);
    if (Number.isFinite(hl)) {
      star.historyLimit = hl;
    }
    if (form.groupsStarToolPolicy) {
      star.toolPolicy = form.groupsStarToolPolicy;
    }
    qqbot.groups = { "*": star };
  }

  return { channels: { qqbot } };
}
