import type { GatewayHealthPluginError } from "../types/gateway";
import type { ChannelConnection, PluginRepairAction, PluginRepairCard } from "../types/app";

/** Strip common ANSI sequences for safer UI display of Gateway errors. */
export function stripAnsiSequences(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

export function extractNpmPackageHint(errorText: string): string | undefined {
  const cleaned = stripAnsiSequences(errorText);
  const scoped = cleaned.match(/@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*/i);
  if (scoped?.[0]) {
    return scoped[0];
  }
  const npmPrefix = cleaned.match(/npm:\s*(@?[\w./@-]+)/i);
  return npmPrefix?.[1];
}

export function interpretPluginHealthError(entry: GatewayHealthPluginError): PluginRepairCard {
  const raw = stripAnsiSequences(entry.error?.trim() || "unknown plugin load error");
  const npmPkg = extractNpmPackageHint(raw);

  const packaging =
    /compiled runtime output|plugin packaging issue|TypeScript entry without compiled/i.test(raw);
  const gitMissing = /spawn git ENOENT|git ENOENT|'git'.*ENOENT/i.test(raw);
  const shadow =
    /shadowed|shadowing|failing config-selected source|stale install record/i.test(raw);

  let headlineZh = "插件加载失败";
  let bodyZh =
    "Gateway 未能加载该插件，对应通道或工具可能不可用。可先尝试 doctor 自动修复，或在终端按下方命令重装 / 停用。";

  if (packaging) {
    headlineZh = "插件包缺少可用编译产物";
    bodyZh =
      "该插件发布的包缺少可用的 JavaScript 运行时入口，多为上游打包问题。建议在发行方修复后更新或强制重装；若暂时不需要，可先停用插件。";
  } else if (gitMissing) {
    headlineZh = "缺少 Git（PATH）";
    bodyZh =
      "安装依赖时需要调用 Git。请在系统中安装 Git，并确保终端可以执行 `git`，然后重试插件安装或 doctor 修复。";
  } else if (shadow) {
    headlineZh = "插件安装来源冲突或被遮蔽";
    bodyZh =
      "检测到多套安装来源或旧的安装记录干扰当前加载顺序。建议 doctor 修复清理记录后，再按需强制重装官方插件包。";
  }

  const actions: PluginRepairAction[] = [];
  actions.push({ label: "尝试 doctor 自动修复", cli: "openclaw doctor --fix" });

  if (npmPkg) {
    const spec = npmPkg.startsWith("npm:") ? npmPkg : `npm:${npmPkg.replace(/^npm:/, "")}`;
    actions.push({
      label: packaging ? "强制重装（npm，常用修复）" : "重装插件（npm）",
      cli: `openclaw plugins install ${spec} --force`,
    });
  } else {
    actions.push({
      label: "强制重装（按插件 ID）",
      cli: `openclaw plugins install ${entry.id} --force`,
    });
  }

  actions.push({
    label: "停用插件（若不再需要）",
    cli: `openclaw plugins disable ${entry.id}`,
  });

  actions.push({
    label: "查阅插件与 CLI 文档",
    docUrl: "https://docs.openclaw.ai/cli/plugins",
  });

  return {
    pluginId: entry.id,
    headlineZh,
    bodyZh,
    rawDetail: raw.length > 280 ? `${raw.slice(0, 280)}…` : raw,
    failurePhase: entry.failurePhase,
    origin: entry.origin,
    actions,
  };
}

export function parseHealthPluginErrors(payload: unknown): GatewayHealthPluginError[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const plugins = (payload as { plugins?: unknown }).plugins;
  if (!plugins || typeof plugins !== "object") {
    return [];
  }
  const errors = (plugins as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) {
    return [];
  }
  const out: GatewayHealthPluginError[] = [];
  for (const row of errors) {
    if (!row || typeof row !== "object") continue;
    const id = (row as { id?: unknown }).id;
    const origin = (row as { origin?: unknown }).origin;
    const errorText = (row as { error?: unknown }).error;
    if (typeof id !== "string" || typeof origin !== "string") continue;
    const activated = Boolean((row as { activated?: unknown }).activated);
    const entry: GatewayHealthPluginError = {
      id,
      origin,
      activated,
      error: typeof errorText === "string" ? errorText : String(errorText ?? ""),
    };
    const activationSource = (row as { activationSource?: unknown }).activationSource;
    if (typeof activationSource === "string") entry.activationSource = activationSource;
    const activationReason = (row as { activationReason?: unknown }).activationReason;
    if (typeof activationReason === "string") entry.activationReason = activationReason;
    const failurePhase = (row as { failurePhase?: unknown }).failurePhase;
    if (typeof failurePhase === "string") entry.failurePhase = failurePhase;
    out.push(entry);
  }
  return out;
}

export function pluginRepairMatchesChannel(card: PluginRepairCard, channelId: string): boolean {
  const pid = card.pluginId.trim().toLowerCase();
  const cid = channelId.trim().toLowerCase();
  if (pid === cid) return true;
  const stripped = pid.replace(/^@openclaw\//, "");
  return stripped === cid;
}

export function mergePluginRepairsIntoConnections(
  connections: ChannelConnection[],
  cards: PluginRepairCard[],
): { connections: ChannelConnection[]; unmatchedRepairs: PluginRepairCard[] } {
  const unmatched = [...cards];
  const next = connections.map((connection) => {
    const matched = cards.filter((card) => pluginRepairMatchesChannel(card, connection.id));
    for (const card of matched) {
      const idx = unmatched.indexOf(card);
      if (idx >= 0) unmatched.splice(idx, 1);
    }
    if (!matched.length) return connection;
    return { ...connection, pluginRepairs: matched };
  });
  return { connections: next, unmatchedRepairs: unmatched };
}
