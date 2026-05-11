import { useMemo, useState } from "react";
import type { ChannelConnection, PluginRepairCard, QqbotPluginStatus, Skill, SkillPolicyHint, WeixinPluginStatus } from "../types/app";
import type { QqbotEditorForm } from "../lib/qqbotChannelPatch";
import { QqbotConfigDialog } from "./QqbotConfigDialog";
import type { GatewayChannelsEventLoopHealth, GatewaySessionsUsageResult, GatewayUsageTotals } from "../types/gateway";
import {
  accountOperationalHealthHint,
  describeHealthState,
  formatGatewayEventLoopSummary,
} from "../lib/channelHealth";
import { buildChannelAccountReadiness, readinessHasSignals } from "../lib/channelCredentialHints";

type TranslateFn = (key: string) => string;
const tt = (t: TranslateFn, key: string, fallback: string) => {
  const value = t(key);
  return value === key ? fallback : value;
};

const supportedChannels = [
  { id: "discord", name: "Discord", detail: "Discord Bot API + Gateway.", docsUrl: "https://docs.openclaw.ai/channels/discord" },
  { id: "feishu", name: "Feishu", detail: "Lark bot. Typical setup includes App ID, App Secret, Verification Token, and Encrypt Key.", docsUrl: "https://docs.openclaw.ai/channels/feishu" },
  { id: "googlechat", name: "Google Chat", detail: "Google Chat API app webhook.", docsUrl: "https://docs.openclaw.ai/channels/google-chat" },
  { id: "imessage", name: "iMessage", detail: "On macOS, bridged by OpenClaw channels.imessage + imsg. BlueBubbles path is deprecated upstream.", docsUrl: "https://docs.openclaw.ai/channels/imessage" },
  { id: "irc", name: "IRC", detail: "Classic IRC server, channels, and DMs.", docsUrl: "https://docs.openclaw.ai/channels/irc" },
  { id: "line", name: "LINE", detail: "LINE Messaging API bot.", docsUrl: "https://docs.openclaw.ai/channels/line" },
  { id: "matrix", name: "Matrix", detail: "Requires an external Matrix channel plugin (ClawHub/npm). SDK is no longer bundled in core releases.", docsUrl: "https://docs.openclaw.ai/channels/matrix" },
  { id: "mattermost", name: "Mattermost", detail: "Bot API + WebSocket.", docsUrl: "https://docs.openclaw.ai/channels/mattermost" },
  { id: "msteams", name: "Microsoft Teams", detail: "Bot Framework enterprise collaboration channel.", docsUrl: "https://docs.openclaw.ai/channels/microsoft-teams" },
  { id: "nextcloud-talk", name: "Nextcloud Talk", detail: "Self-hosted chat on Nextcloud Talk.", docsUrl: "https://docs.openclaw.ai/channels/nextcloud-talk" },
  { id: "nostr", name: "Nostr", detail: "NIP-04 decentralized DMs.", docsUrl: "https://docs.openclaw.ai/channels/nostr" },
  {
    id: "qqbot",
    name: "QQ Bot",
    detail: "QQ Open Platform bot (see config guide).",
    docsUrl: "https://docs.openclaw.ai/channels/qqbot",
    packageName: "@openclaw/qqbot",
  },
  { id: "signal", name: "Signal", detail: "signal-cli privacy channel.", docsUrl: "https://docs.openclaw.ai/channels/signal" },
  { id: "slack", name: "Slack", detail: "Slack Bolt SDK workspace app.", docsUrl: "https://docs.openclaw.ai/channels/slack" },
  { id: "synology-chat", name: "Synology Chat", detail: "Synology NAS Chat webhook.", docsUrl: "https://docs.openclaw.ai/channels/synology-chat" },
  { id: "telegram", name: "Telegram", detail: "Bot API via grammY with group support.", docsUrl: "https://docs.openclaw.ai/channels/telegram" },
  { id: "tlon", name: "Tlon", detail: "Urbit-based messenger.", docsUrl: "https://docs.openclaw.ai/channels/tlon" },
  { id: "twitch", name: "Twitch", detail: "Twitch chat via IRC.", docsUrl: "https://docs.openclaw.ai/channels/twitch" },
  { id: "openclaw-weixin", name: "WeChat", detail: "Tencent iLink Bot plugin installed via external npm package. QR login currently supports direct chat.", docsUrl: "https://docs.openclaw.ai/channels/wechat", packageName: "@tencent-weixin/openclaw-weixin" },
  { id: "whatsapp", name: "WhatsApp", detail: "Baileys + QR pairing.", docsUrl: "https://docs.openclaw.ai/channels/whatsapp" },
  { id: "zalo", name: "Zalo", detail: "Zalo Bot API.", docsUrl: "https://docs.openclaw.ai/channels/zalo" },
  { id: "zalouser", name: "Zalo Personal", detail: "Personal account QR login.", docsUrl: "https://docs.openclaw.ai/channels/zalo-personal" },
];

function formatTokens(value?: number) {
  if (!value) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function resolveTotal(totals?: GatewayUsageTotals) {
  return totals?.total ?? totals?.totalTokens ?? 0;
}

function resolveCost(totals?: GatewayUsageTotals) {
  return totals?.cost ?? totals?.totalCost ?? totals?.estimatedCostUsd ?? 0;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

function PluginRepairActions({ actions, t }: { actions: PluginRepairCard["actions"]; t: TranslateFn }) {
  if (!actions.length) return null;
  return (
    <div className="plugin-repair-actions">
      {actions.map((action) => (
        <div className="plugin-repair-action" key={`${action.label}-${action.cli ?? action.docUrl ?? ""}`}>
          <span className="plugin-repair-action-label">{action.label}</span>
          {action.cli ? (
            <button type="button" className="plugin-repair-cli" onClick={() => void copyToClipboard(action.cli!)} title={tt(t, "common.copyCommand", "Copy command to clipboard")}>
              <code>{action.cli}</code>
            </button>
          ) : null}
          {action.docUrl ? (
            <a className="ghost-link-button" href={action.docUrl} target="_blank" rel="noreferrer">
              {tt(t, "common.openDocs", "Open docs")}
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function PluginRepairStack({
  title,
  items,
  t,
  variant = "section",
}: {
  title: string;
  items: PluginRepairCard[];
  t: TranslateFn;
  variant?: "section" | "inline";
}) {
  if (!items.length) return null;
  return (
    <div className={`plugin-repair-stack ${variant === "inline" ? "is-inline" : ""}`} role="region" aria-label={title}>
      <div className="plugin-repair-stack-title">{title}</div>
      <div className="plugin-repair-stack-body">
        {items.map((card, index) => (
          <article className="plugin-repair-card" key={`${card.pluginId}-${index}`}>
            <div className="plugin-repair-card-head">
              <strong>{card.headlineZh}</strong>
              <span className="plugin-repair-id">{card.pluginId}</span>
            </div>
            <p className="plugin-repair-body">{card.bodyZh}</p>
            {card.rawDetail ? (
              <details className="plugin-repair-technical">
                <summary>{tt(t, "common.viewRawError", "View raw error summary")}</summary>
                <pre>{card.rawDetail}</pre>
              </details>
            ) : null}
            <PluginRepairActions actions={card.actions} t={t} />
          </article>
        ))}
      </div>
    </div>
  );
}

function SkillPolicyHints({ hints, t }: { hints: SkillPolicyHint[]; t: TranslateFn }) {
  if (!hints.length) return null;
  return (
    <div className="skill-policy-hints">
      {hints.map((hint, index) => (
        <div className={`skill-policy-hint is-${hint.severity}`} key={`${hint.title}-${index}`}>
          <strong>{hint.title}</strong>
          <p>{hint.body}</p>
          <PluginRepairActions actions={hint.actions ?? []} t={t} />
        </div>
      ))}
    </div>
  );
}
function ChannelAccountReadinessPanel({
  account,
  t,
}: {
  account: NonNullable<ChannelConnection["accounts"]>[number];
  t: TranslateFn;
}) {
  const readiness = buildChannelAccountReadiness(account);
  if (!readinessHasSignals(readiness)) {
    return null;
  }
  return (
    <div className="connection-account-readiness">
      {readiness.secretResolution.length ? (
        <div className="readiness-group readiness-secret-resolution">
          <span className="readiness-group-label">{tt(t, "connections.secretResolution", "Secret / SecretRef (resolved)")}</span>
          <ul>
            {readiness.secretResolution.map((line, idx) => (
              <li key={`sr-${idx}`}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {readiness.credentialGaps.length ? (
        <div className="readiness-group readiness-credential-gap">
          <span className="readiness-group-label">{tt(t, "connections.credentialGaps", "Credential gaps")}</span>
          <ul>
            {readiness.credentialGaps.map((line, idx) => (
              <li key={`cg-${idx}`}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {readiness.pluginContract ? (
        <div className="readiness-group readiness-plugin-contract">
          <span className="readiness-group-label">{tt(t, "connections.pluginContract", "Plugin contract / manifest")}</span>
          <p>{readiness.pluginContract}</p>
        </div>
      ) : null}
    </div>
  );
}

const connectionRank: Record<ChannelConnection["status"], number> = {
  connected: 0,
  degraded: 1,
  warning: 2,
  disabled: 3,
};

export function SkillsPage({
  skills,
  pluginLoadRepairs,
  loading,
  t,
  onToggleSkill,
}: {
  skills: Skill[];
  pluginLoadRepairs: PluginRepairCard[];
  loading: boolean;
  t: TranslateFn;
  onToggleSkill: (skillId: string, enabled: boolean) => void;
}) {
  return (
    <section className="single-page">
      {loading ? <div className="inline-page-status">{tt(t, "skills.loading", "Syncing skill status...")}</div> : null}
      <PluginRepairStack title={tt(t, "skills.pluginRuntimeIssues", "Plugin runtime load issues (from Gateway health)")} items={pluginLoadRepairs} t={t} />
      <div className="card-grid-panel skills-grid">
        {skills.map((skill) => (
          <article className="info-card skill-card" key={skill.id}>
            <div className="card-row">
              <div className="skill-title">
                <strong>{skill.name}</strong>
                {skill.eligible === false ? <span className="small-warning">{tt(t, "skills.dependencyMissing", "Dependencies missing")}</span> : null}
              </div>
              <label className="switch-control" title={skill.enabled ? tt(t, "skills.disable", "Disable skill") : tt(t, "skills.enable", "Enable skill")}>
                <input
                  type="checkbox"
                  checked={skill.enabled}
                  onChange={(event) => onToggleSkill(skill.id, event.target.checked)}
                />
                <span />
              </label>
            </div>
            <p>{skill.description || skill.summary || tt(t, "skills.noDescription", "No skill description.")}</p>
            <SkillPolicyHints hints={skill.policyHints ?? []} t={t} />
            {skill.missing?.length ? <div className="skill-missing">{tt(t, "skills.missing", "Missing")}: {skill.missing.join(", ")}</div> : null}
          </article>
        ))}
        {!skills.length && !loading ? <div className="empty-panel">{tt(t, "skills.empty", "No skills to display.")}</div> : null}
      </div>
    </section>
  );
}

export function ConnectionsPage({
  connections,
  connectionLabel,
  eventLoopHealth,
  unmatchedPluginRepairs,
  loading,
  gatewayConnected,
  weixinStatus,
  weixinBusy,
  weixinMessage,
  qqbotBusy,
  qqbotStatusBusy,
  qqbotNotice,
  qqbotPluginRegistered,
  qqbotStatus,
  t,
  onRefreshWeixinStatus,
  onEnableWeixin,
  onInstallWeixin,
  onUpdateWeixin,
  onLoginWeixin,
  onInstallQqbotPlugin,
  onRefreshQqbotStatus,
  onLoadQqbotEditorForm,
  onSaveQqbotSettings,
  onDismissQqbotNotice,
}: {
  connections: ChannelConnection[];
  connectionLabel: Record<ChannelConnection["status"], string>;
  eventLoopHealth: GatewayChannelsEventLoopHealth | null;
  unmatchedPluginRepairs: PluginRepairCard[];
  loading: boolean;
  gatewayConnected: boolean;
  weixinStatus: WeixinPluginStatus | null;
  weixinBusy: boolean;
  weixinMessage: string | null;
  qqbotBusy: boolean;
  qqbotStatusBusy: boolean;
  qqbotNotice: { text: string; tone: "success" | "error" } | null;
  qqbotPluginRegistered: boolean;
  qqbotStatus: QqbotPluginStatus | null;
  t: TranslateFn;
  onRefreshWeixinStatus: () => void;
  onEnableWeixin: () => void;
  onInstallWeixin: () => void;
  onUpdateWeixin: () => void;
  onLoginWeixin: () => void;
  onInstallQqbotPlugin: () => void | Promise<void>;
  onRefreshQqbotStatus: () => void | Promise<void>;
  onLoadQqbotEditorForm: () => Promise<QqbotEditorForm>;
  onSaveQqbotSettings: (form: QqbotEditorForm) => void | Promise<void>;
  onDismissQqbotNotice?: () => void;
}) {
  const [qqbotDialogOpen, setQqbotDialogOpen] = useState(false);
  const eventLoopBanner =
    eventLoopHealth?.degraded === true ? formatGatewayEventLoopSummary(eventLoopHealth) : null;
  const connectionMap = new Map(connections.map((connection) => [connection.id, connection]));
  const rows = supportedChannels.map((channel) => {
    const gatewayConnection = connectionMap.get(channel.id);
    return {
      ...channel,
      ...gatewayConnection,
      name: gatewayConnection?.name ?? channel.name,
      detail: gatewayConnection?.detail ?? channel.detail,
      config: gatewayConnection?.config ?? `channels.${channel.id}`,
      activity: gatewayConnection?.activity ?? tt(t, "connections.notEnabled", "Not enabled"),
      status: gatewayConnection?.status ?? "disabled",
      docsUrl: gatewayConnection?.docsUrl ?? channel.docsUrl,
      packageName: gatewayConnection?.packageName ?? channel.packageName,
    } satisfies ChannelConnection & { docsUrl?: string; packageName?: string };
  }).sort((left, right) => connectionRank[left.status] - connectionRank[right.status] || left.name.localeCompare(right.name));

  return (
    <section className="single-page">
      {loading ? <div className="inline-page-status">{tt(t, "connections.loading", "Syncing connection status...")}</div> : null}
      {eventLoopBanner ? (
        <div className="channel-event-loop-banner" role="status">
          <strong>{tt(t, "connections.eventLoopDegraded", "Gateway event loop degraded")}</strong>
          <p>{eventLoopBanner}</p>
        </div>
      ) : null}
      <PluginRepairStack
        title={tt(t, "connections.unmatchedPluginErrors", "Plugin load errors not mapped to one channel card")}
        items={unmatchedPluginRepairs}
        t={t}
      />
      <div className="connection-list-panel">
        {rows.map((connection) => {
          const isWeixin = connection.id === "openclaw-weixin";
          const isQqbot = connection.id === "qqbot";
          const qqbotBadgeLabel =
            isQqbot && qqbotPluginRegistered && connection.status === "disabled"
              ? qqbotStatus?.enabled === false
                ? tt(t, "connections.installedDisabled", "Installed (disabled)")
                : tt(t, "connections.installed", "Installed")
              : null;
          const displayStatus =
            isWeixin && weixinStatus?.enabled && connection.status === "disabled" ? "warning" : connection.status;
          const displayStatusLabel =
            isWeixin && weixinStatus?.enabled && connection.status !== "connected" && connection.status !== "degraded"
              ? tt(t, "common.enabled", "Enabled")
              : qqbotBadgeLabel ?? connectionLabel[connection.status];
          const weixinVersionText = weixinStatus?.installed
            ? [
                weixinStatus.installedVersion ? `${tt(t, "connections.installed", "Installed")} v${weixinStatus.installedVersion}` : tt(t, "connections.installed", "Installed"),
                weixinStatus.latestVersion ? `${tt(t, "common.latest", "Latest")} v${weixinStatus.latestVersion}` : weixinStatus.latestCheckError ? tt(t, "connections.latestCheckFailed", "Failed to check latest version") : null,
              ].filter(Boolean).join(" · ")
            : weixinBusy
              ? tt(t, "connections.checkingInstallStatus", "Checking installation status...")
            : tt(t, "connections.notInstalled", "Not installed");

          return (
            <article className={`info-card connection-card ${isWeixin && weixinBusy ? "is-checking" : ""}`} key={connection.id}>
              <div className="connection-card-head">
                <div className="connection-title-block">
                  <strong>{connection.name}</strong>
                  <div className="connection-meta-line">
                    {connection.packageName ? <code>{connection.packageName}</code> : null}
                  </div>
                </div>
                {isWeixin && weixinBusy ? (
                  <span className="channel-checking-pill"><span className="mini-spinner" />{tt(t, "common.checking", "Checking")}</span>
                ) : (
                  <span className={`toggle-badge ${displayStatus}`}>{displayStatusLabel}</span>
                )}
              </div>
              {isQqbot ? (
                <p className="connection-qqbot-summary">
                  {!gatewayConnected
                    ? tt(t, "connections.qqbot.gatewayDisconnected", "Gateway is disconnected. Cannot detect plugin status or save config.")
                    : !qqbotPluginRegistered
                      ? tt(t, "connections.qqbot.notLoaded", "Gateway has not loaded the QQ Bot plugin yet. Install @openclaw/qqbot first.")
                      : [
                          qqbotStatus?.enabled ? tt(t, "connections.qqbot.pluginEnabled", "Plugin enabled") : tt(t, "connections.qqbot.pluginInstalled", "Plugin installed"),
                          qqbotStatus?.installedVersion ? `v${qqbotStatus.installedVersion}` : null,
                          qqbotStatus?.latestVersion ? `${tt(t, "common.latest", "Latest")} v${qqbotStatus.latestVersion}` : null,
                        ].filter(Boolean).join(" · ") || connection.activity || tt(t, "connections.qqbot.registeredHint", "Plugin is registered. Use Configure to manage credentials and group policy.")}
                </p>
              ) : (
                <p>{connection.detail}</p>
              )}
              {!isQqbot && connection.healthHint ? (
                <div className="connection-health-hint">{tt(t, "connections.runtimeHint", "Channel runtime hint")}: {connection.healthHint}</div>
              ) : null}
              {!isQqbot && connection.pluginRepairs?.length ? (
                <PluginRepairStack title={tt(t, "connections.pluginDiagnostics", "Plugin diagnostics")} items={connection.pluginRepairs} t={t} variant="inline" />
              ) : null}
              {isWeixin ? <div className="connection-version-line">{weixinVersionText}</div> : null}
              {!isQqbot && connection.accounts?.length ? (
                <div className="connection-accounts">
                  {connection.accounts.map((account) => {
                    const hint = accountOperationalHealthHint(account);
                    const hs = account.healthState?.trim();
                    const titleParts = [
                      hint,
                      hs && hs !== "healthy" ? `Gateway: ${describeHealthState(hs)} (${hs})` : null,
                      account.linked === false ? tt(t, "connections.accountNotLinked", "Not linked to a valid config") : null,
                    ].filter(Boolean);
                    const summary = `${account.name || account.accountId} · ${
                      account.connected ? tt(t, "common.connected", "Connected") : account.configured ? tt(t, "common.configured", "Configured") : tt(t, "common.pendingConfig", "Pending config")
                    }${hint ? ` · ${hint}` : ""}`;
                    return (
                      <div className="connection-account-entry" key={account.accountId}>
                        <span className="connection-account-pill" title={titleParts.length ? titleParts.join(" · ") : undefined}>
                          {summary}
                        </span>
                        <ChannelAccountReadinessPanel account={account} t={t} />
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <div className="connection-actions-row">
                <div>
                  {isQqbot ? (
                    <>
                      <button className="ghost-link-button" type="button" onClick={() => void onRefreshQqbotStatus()} disabled={qqbotStatusBusy}>
                        {qqbotStatusBusy ? tt(t, "common.checking", "Checking") : tt(t, "common.refresh", "Refresh")}
                      </button>
                      {!qqbotPluginRegistered ? (
                        <button className="ghost-link-button primary-action" type="button" onClick={() => void onInstallQqbotPlugin()} disabled={qqbotStatusBusy}>
                          {tt(t, "connections.installPlugin", "Install plugin")}
                        </button>
                      ) : null}
                      <button
                        className="ghost-link-button primary-action"
                        type="button"
                        onClick={() => {
                          onDismissQqbotNotice?.();
                          setQqbotDialogOpen(true);
                        }}
                      >
                        {tt(t, "common.configure", "Configure")}
                      </button>
                      <QqbotConfigDialog
                        open={qqbotDialogOpen}
                        onClose={() => {
                          setQqbotDialogOpen(false);
                          onDismissQqbotNotice?.();
                        }}
                        gatewayConnected={gatewayConnected}
                        pluginInstalled={qqbotPluginRegistered}
                        pluginRepairs={connection.pluginRepairs ?? []}
                        t={t}
                        loadForm={onLoadQqbotEditorForm}
                        onSave={onSaveQqbotSettings}
                        busy={qqbotBusy}
                        notice={qqbotNotice}
                        onInstallPlugin={onInstallQqbotPlugin}
                      />
                    </>
                  ) : null}
                  {isWeixin ? (
                    <>
                      <button className="ghost-link-button" type="button" onClick={onRefreshWeixinStatus} disabled={weixinBusy}>
                        {weixinBusy ? tt(t, "common.checking", "Checking") : tt(t, "common.refresh", "Refresh")}
                      </button>
                      {weixinStatus?.installed ? (
                        <>
                          {!weixinStatus.enabled ? (
                            <button className="ghost-link-button primary-action" type="button" onClick={onEnableWeixin} disabled={weixinBusy}>
                              {tt(t, "common.enable", "Enable")}
                            </button>
                          ) : null}
                          {weixinStatus.enabled && weixinStatus.updateAvailable ? (
                            <button className="ghost-link-button primary-action" type="button" onClick={onUpdateWeixin} disabled={weixinBusy}>
                              {tt(t, "common.update", "Update")}
                            </button>
                          ) : null}
                          {weixinStatus.enabled ? (
                            <button className="ghost-link-button primary-action" type="button" onClick={onLoginWeixin} disabled={weixinBusy}>
                              {tt(t, "common.login", "Login")}
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <button className="ghost-link-button primary-action" type="button" onClick={onInstallWeixin} disabled={weixinBusy}>
                          {tt(t, "common.install", "Install")}
                        </button>
                      )}
                    </>
                  ) : null}
                  {connection.docsUrl ? (
                    <a className="ghost-link-button" href={connection.docsUrl} target="_blank" rel="noreferrer">
                      {tt(t, "common.docs", "Docs")}
                    </a>
                  ) : null}
                </div>
              </div>
              {isWeixin && weixinMessage ? (
                <div className="qr-login-panel">
                  <div>
                    <strong>{tt(t, "connections.wechatLogin", "WeChat login")}</strong>
                    <p>{weixinMessage}</p>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function UsagePage({
  usage,
  loading,
  t,
}: {
  usage: GatewaySessionsUsageResult | null;
  loading: boolean;
  t: TranslateFn;
}) {
  const displayUsage = loading ? null : usage;
  const totals = displayUsage?.totals;
  const daily = displayUsage?.aggregates?.daily ?? [];
  const byAgent = useMemo(
    () => (displayUsage?.aggregates?.byAgent ?? []).filter((row) => resolveTotal(row.totals) > 0),
    [displayUsage?.aggregates?.byAgent],
  );
  const byModel = useMemo(
    () => (displayUsage?.aggregates?.byModel ?? []).filter((row) => resolveTotal(row.totals) > 0),
    [displayUsage?.aggregates?.byModel],
  );
  const sessions = useMemo(
    () => (displayUsage?.sessions ?? []).filter((session) => resolveTotal(session.usage ?? undefined) > 0).slice(0, 40),
    [displayUsage?.sessions],
  );
  const maxDailyTokens = useMemo(() => Math.max(1, ...daily.map((item) => item.tokens || 0)), [daily]);

  return (
    <section className="single-page usage-page">
      {loading ? <div className="inline-page-status">{tt(t, "usage.loading", "Calculating usage...")}</div> : null}
      <div className="usage-summary-grid">
        <div className="usage-stat"><span className="usage-icon token-icon" /><div><span>{tt(t, "usage.totalTokens", "Total tokens")}</span><strong>{formatTokens(resolveTotal(totals))}</strong></div></div>
        <div className="usage-stat"><span className="usage-icon input-icon" /><div><span>{tt(t, "usage.input", "Input")}</span><strong>{formatTokens(totals?.input)}</strong></div></div>
        <div className="usage-stat"><span className="usage-icon output-icon" /><div><span>{tt(t, "usage.output", "Output")}</span><strong>{formatTokens(totals?.output)}</strong></div></div>
        <div className="usage-stat"><span className="usage-icon cache-icon" /><div><span>{tt(t, "usage.cacheRead", "Cache read")}</span><strong>{formatTokens(totals?.cacheRead)}</strong></div></div>
        <div className="usage-stat"><span className="usage-icon cache-write-icon" /><div><span>{tt(t, "usage.cacheWrite", "Cache write")}</span><strong>{formatTokens(totals?.cacheWrite)}</strong></div></div>
        <div className="usage-stat"><span className="usage-icon cost-icon" /><div><span>{tt(t, "usage.cost", "Cost")}</span><strong>${resolveCost(totals).toFixed(4)}</strong></div></div>
      </div>
      <section className="daily-usage-panel">
        <h2>{tt(t, "usage.daily", "Daily usage")}</h2>
        <div className="daily-usage-bars">
          {daily.slice(-14).map((day) => (
            <div className="daily-usage-bar" key={day.date}>
              <span>{formatTokens(day.tokens)}</span>
              <div><i style={{ height: `${Math.max(6, (day.tokens / maxDailyTokens) * 100)}%` }} /></div>
              <em>{day.date.slice(5)}</em>
            </div>
          ))}
          {!daily.length ? <div className="empty-panel">{tt(t, "usage.dailyEmpty", "No daily usage data yet.")}</div> : null}
        </div>
      </section>
      <div className="usage-columns">
        <section>
          <h2>{tt(t, "usage.byAgent", "By agent")}</h2>
          {byAgent.map((row) => (
            <div className="usage-row" key={row.agentId}>
              <span>{row.agentId}</span>
              <strong>{formatTokens(resolveTotal(row.totals))}</strong>
            </div>
          ))}
          {!byAgent.length && !loading ? <div className="usage-empty-row">{tt(t, "usage.byAgentEmpty", "No agent usage yet.")}</div> : null}
        </section>
        <section>
          <h2>{tt(t, "usage.byModel", "By model")}</h2>
          {byModel.map((row, index) => (
            <div className="usage-row" key={`${row.provider ?? "provider"}-${row.model ?? "model"}-${index}`}>
              <span>{[row.provider, row.model].filter(Boolean).join(" / ") || "unknown"}</span>
              <strong>{formatTokens(resolveTotal(row.totals))}</strong>
            </div>
          ))}
          {!byModel.length && !loading ? <div className="usage-empty-row">{tt(t, "usage.byModelEmpty", "No model usage yet.")}</div> : null}
        </section>
      </div>
      <section className="usage-table-panel">
        <h2>{tt(t, "usage.sessions", "Conversations")}</h2>
        {sessions.map((session) => (
          <div className="usage-session-row" key={session.key}>
            <span>{session.label || session.key}</span>
            <span>{session.agentId || "-"}</span>
            <span>{[session.modelProvider, session.model].filter(Boolean).join(" / ") || "-"}</span>
            <strong>{formatTokens(resolveTotal(session.usage ?? undefined))}</strong>
          </div>
        ))}
        {!sessions.length && !loading ? <div className="usage-empty-row">{tt(t, "usage.sessionsEmpty", "No conversations with token usage yet.")}</div> : null}
      </section>
    </section>
  );
}
