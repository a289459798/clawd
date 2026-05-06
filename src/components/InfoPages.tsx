import { useMemo } from "react";
import type { ChannelConnection, PluginRepairCard, Skill, SkillPolicyHint, WeixinPluginStatus } from "../types/app";
import type { GatewayChannelsEventLoopHealth, GatewaySessionsUsageResult, GatewayUsageTotals } from "../types/gateway";
import {
  accountOperationalHealthHint,
  describeHealthState,
  formatGatewayEventLoopSummary,
} from "../lib/channelHealth";
import { buildChannelAccountReadiness, readinessHasSignals } from "../lib/channelCredentialHints";

const supportedChannels = [
  { id: "bluebubbles", name: "BlueBubbles", detail: "iMessage 推荐通道，连接 BlueBubbles macOS server。", docsUrl: "https://docs.openclaw.ai/channels/bluebubbles" },
  { id: "discord", name: "Discord", detail: "Discord Bot API + Gateway。", docsUrl: "https://docs.openclaw.ai/channels/discord" },
  { id: "feishu", name: "Feishu", detail: "飞书/Lark 机器人，常用配置为 App ID、App Secret、Verification Token、Encrypt Key。", docsUrl: "https://docs.openclaw.ai/channels/feishu" },
  { id: "googlechat", name: "Google Chat", detail: "Google Chat API app webhook。", docsUrl: "https://docs.openclaw.ai/channels/google-chat" },
  { id: "imessage", name: "iMessage", detail: "legacy macOS 集成，新配置建议优先使用 BlueBubbles。", docsUrl: "https://docs.openclaw.ai/channels/imessage" },
  { id: "irc", name: "IRC", detail: "经典 IRC server、频道和 DM。", docsUrl: "https://docs.openclaw.ai/channels/irc" },
  { id: "line", name: "LINE", detail: "LINE Messaging API bot。", docsUrl: "https://docs.openclaw.ai/channels/line" },
  { id: "matrix", name: "Matrix", detail: "Matrix protocol。", docsUrl: "https://docs.openclaw.ai/channels/matrix" },
  { id: "mattermost", name: "Mattermost", detail: "Bot API + WebSocket。", docsUrl: "https://docs.openclaw.ai/channels/mattermost" },
  { id: "msteams", name: "Microsoft Teams", detail: "Bot Framework 企业协作通道。", docsUrl: "https://docs.openclaw.ai/channels/microsoft-teams" },
  { id: "nextcloud-talk", name: "Nextcloud Talk", detail: "Nextcloud Talk 自托管聊天。", docsUrl: "https://docs.openclaw.ai/channels/nextcloud-talk" },
  { id: "nostr", name: "Nostr", detail: "NIP-04 decentralized DMs。", docsUrl: "https://docs.openclaw.ai/channels/nostr" },
  { id: "qqbot", name: "QQ Bot", detail: "QQ Bot API，支持私聊、群聊和富媒体。", docsUrl: "https://docs.openclaw.ai/channels/qq-bot" },
  { id: "signal", name: "Signal", detail: "signal-cli 隐私通道。", docsUrl: "https://docs.openclaw.ai/channels/signal" },
  { id: "slack", name: "Slack", detail: "Slack Bolt SDK workspace app。", docsUrl: "https://docs.openclaw.ai/channels/slack" },
  { id: "synology-chat", name: "Synology Chat", detail: "Synology NAS Chat webhook。", docsUrl: "https://docs.openclaw.ai/channels/synology-chat" },
  { id: "telegram", name: "Telegram", detail: "Bot API via grammY，支持群组。", docsUrl: "https://docs.openclaw.ai/channels/telegram" },
  { id: "tlon", name: "Tlon", detail: "Urbit-based messenger。", docsUrl: "https://docs.openclaw.ai/channels/tlon" },
  { id: "twitch", name: "Twitch", detail: "Twitch chat via IRC。", docsUrl: "https://docs.openclaw.ai/channels/twitch" },
  { id: "openclaw-weixin", name: "WeChat", detail: "腾讯 iLink Bot 插件，外部 npm 包安装，扫码登录，当前支持私聊。", docsUrl: "https://docs.openclaw.ai/channels/wechat", packageName: "@tencent-weixin/openclaw-weixin" },
  { id: "whatsapp", name: "WhatsApp", detail: "Baileys + QR pairing。", docsUrl: "https://docs.openclaw.ai/channels/whatsapp" },
  { id: "zalo", name: "Zalo", detail: "Zalo Bot API。", docsUrl: "https://docs.openclaw.ai/channels/zalo" },
  { id: "zalouser", name: "Zalo Personal", detail: "个人账号扫码登录。", docsUrl: "https://docs.openclaw.ai/channels/zalo-personal" },
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

function PluginRepairActions({ actions }: { actions: PluginRepairCard["actions"] }) {
  if (!actions.length) return null;
  return (
    <div className="plugin-repair-actions">
      {actions.map((action) => (
        <div className="plugin-repair-action" key={`${action.label}-${action.cli ?? action.docUrl ?? ""}`}>
          <span className="plugin-repair-action-label">{action.label}</span>
          {action.cli ? (
            <button type="button" className="plugin-repair-cli" onClick={() => void copyToClipboard(action.cli!)} title="复制命令到剪贴板">
              <code>{action.cli}</code>
            </button>
          ) : null}
          {action.docUrl ? (
            <a className="ghost-link-button" href={action.docUrl} target="_blank" rel="noreferrer">
              打开文档
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
  variant = "section",
}: {
  title: string;
  items: PluginRepairCard[];
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
                <summary>查看原始错误摘要</summary>
                <pre>{card.rawDetail}</pre>
              </details>
            ) : null}
            <PluginRepairActions actions={card.actions} />
          </article>
        ))}
      </div>
    </div>
  );
}

function SkillPolicyHints({ hints }: { hints: SkillPolicyHint[] }) {
  if (!hints.length) return null;
  return (
    <div className="skill-policy-hints">
      {hints.map((hint, index) => (
        <div className={`skill-policy-hint is-${hint.severity}`} key={`${hint.title}-${index}`}>
          <strong>{hint.title}</strong>
          <p>{hint.body}</p>
          <PluginRepairActions actions={hint.actions ?? []} />
        </div>
      ))}
    </div>
  );
}
function ChannelAccountReadinessPanel({
  account,
}: {
  account: NonNullable<ChannelConnection["accounts"]>[number];
}) {
  const readiness = buildChannelAccountReadiness(account);
  if (!readinessHasSignals(readiness)) {
    return null;
  }
  return (
    <div className="connection-account-readiness">
      {readiness.secretResolution.length ? (
        <div className="readiness-group readiness-secret-resolution">
          <span className="readiness-group-label">密钥 / SecretRef（解析）</span>
          <ul>
            {readiness.secretResolution.map((line, idx) => (
              <li key={`sr-${idx}`}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {readiness.credentialGaps.length ? (
        <div className="readiness-group readiness-credential-gap">
          <span className="readiness-group-label">凭证缺口</span>
          <ul>
            {readiness.credentialGaps.map((line, idx) => (
              <li key={`cg-${idx}`}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {readiness.pluginContract ? (
        <div className="readiness-group readiness-plugin-contract">
          <span className="readiness-group-label">插件契约 / 清单</span>
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
  onToggleSkill,
}: {
  skills: Skill[];
  pluginLoadRepairs: PluginRepairCard[];
  loading: boolean;
  onToggleSkill: (skillId: string, enabled: boolean) => void;
}) {
  return (
    <section className="single-page">
      {loading ? <div className="inline-page-status">正在同步技能状态...</div> : null}
      <PluginRepairStack title="插件运行时加载问题（来自 Gateway health）" items={pluginLoadRepairs} />
      <div className="card-grid-panel skills-grid">
        {skills.map((skill) => (
          <article className="info-card skill-card" key={skill.id}>
            <div className="card-row">
              <div className="skill-title">
                <strong>{skill.name}</strong>
                {skill.eligible === false ? <span className="small-warning">依赖未满足</span> : null}
              </div>
              <label className="switch-control" title={skill.enabled ? "关闭技能" : "启用技能"}>
                <input
                  type="checkbox"
                  checked={skill.enabled}
                  onChange={(event) => onToggleSkill(skill.id, event.target.checked)}
                />
                <span />
              </label>
            </div>
            <p>{skill.description || skill.summary || "暂无技能说明。"}</p>
            <SkillPolicyHints hints={skill.policyHints ?? []} />
            {skill.missing?.length ? <div className="skill-missing">缺少：{skill.missing.join("、")}</div> : null}
          </article>
        ))}
        {!skills.length && !loading ? <div className="empty-panel">暂无可展示技能。</div> : null}
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
  weixinStatus,
  weixinBusy,
  weixinMessage,
  onRefreshWeixinStatus,
  onEnableWeixin,
  onInstallWeixin,
  onUpdateWeixin,
  onLoginWeixin,
}: {
  connections: ChannelConnection[];
  connectionLabel: Record<ChannelConnection["status"], string>;
  eventLoopHealth: GatewayChannelsEventLoopHealth | null;
  unmatchedPluginRepairs: PluginRepairCard[];
  loading: boolean;
  weixinStatus: WeixinPluginStatus | null;
  weixinBusy: boolean;
  weixinMessage: string | null;
  onRefreshWeixinStatus: () => void;
  onEnableWeixin: () => void;
  onInstallWeixin: () => void;
  onUpdateWeixin: () => void;
  onLoginWeixin: () => void;
}) {
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
      activity: gatewayConnection?.activity ?? "未启用",
      status: gatewayConnection?.status ?? "disabled",
      docsUrl: gatewayConnection?.docsUrl ?? channel.docsUrl,
      packageName: gatewayConnection?.packageName ?? channel.packageName,
    } satisfies ChannelConnection & { docsUrl?: string; packageName?: string };
  }).sort((left, right) => connectionRank[left.status] - connectionRank[right.status] || left.name.localeCompare(right.name));

  return (
    <section className="single-page">
      {loading ? <div className="inline-page-status">正在同步连接状态...</div> : null}
      {eventLoopBanner ? (
        <div className="channel-event-loop-banner" role="status">
          <strong>Gateway 事件循环降级</strong>
          <p>{eventLoopBanner}</p>
        </div>
      ) : null}
      <PluginRepairStack
        title="未能映射到单一通道卡片的插件加载错误（仍可能影响后台工具或其他模块）"
        items={unmatchedPluginRepairs}
      />
      <div className="connection-list-panel">
        {rows.map((connection) => {
          const isWeixin = connection.id === "openclaw-weixin";
          const displayStatus =
            isWeixin && weixinStatus?.enabled && connection.status === "disabled" ? "warning" : connection.status;
          const displayStatusLabel =
            isWeixin && weixinStatus?.enabled && connection.status !== "connected" && connection.status !== "degraded"
              ? "已启用"
              : connectionLabel[connection.status];
          const weixinVersionText = weixinStatus?.installed
            ? [
                weixinStatus.installedVersion ? `已安装 v${weixinStatus.installedVersion}` : "已安装",
                weixinStatus.latestVersion ? `最新 v${weixinStatus.latestVersion}` : weixinStatus.latestCheckError ? "最新版检测失败" : null,
              ].filter(Boolean).join(" · ")
            : weixinBusy
              ? "正在检测安装状态..."
            : "未安装";

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
                  <span className="channel-checking-pill"><span className="mini-spinner" />检测中</span>
                ) : (
                  <span className={`toggle-badge ${displayStatus}`}>{displayStatusLabel}</span>
                )}
              </div>
              <p>{connection.detail}</p>
              {connection.healthHint ? <div className="connection-health-hint">通道运行异常提示：{connection.healthHint}</div> : null}
              {connection.pluginRepairs?.length ? (
                <PluginRepairStack title="插件加载诊断" items={connection.pluginRepairs} variant="inline" />
              ) : null}
              {isWeixin ? <div className="connection-version-line">{weixinVersionText}</div> : null}
              {connection.accounts?.length ? (
                <div className="connection-accounts">
                  {connection.accounts.map((account) => {
                    const hint = accountOperationalHealthHint(account);
                    const hs = account.healthState?.trim();
                    const titleParts = [
                      hint,
                      hs && hs !== "healthy" ? `Gateway：${describeHealthState(hs)}（${hs}）` : null,
                      account.linked === false ? "未关联到有效配置" : null,
                    ].filter(Boolean);
                    const summary = `${account.name || account.accountId} · ${
                      account.connected ? "已连接" : account.configured ? "已配置" : "待配置"
                    }${hint ? ` · ${hint}` : ""}`;
                    return (
                      <div className="connection-account-entry" key={account.accountId}>
                        <span className="connection-account-pill" title={titleParts.length ? titleParts.join(" · ") : undefined}>
                          {summary}
                        </span>
                        <ChannelAccountReadinessPanel account={account} />
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <div className="connection-actions-row">
                <div>
                  {isWeixin ? (
                    <>
                      <button className="ghost-link-button" type="button" onClick={onRefreshWeixinStatus} disabled={weixinBusy}>
                        {weixinBusy ? "检测中" : "重新检测"}
                      </button>
                      {weixinStatus?.installed ? (
                        <>
                          {!weixinStatus.enabled ? (
                            <button className="ghost-link-button primary-action" type="button" onClick={onEnableWeixin} disabled={weixinBusy}>
                              启用
                            </button>
                          ) : null}
                          {weixinStatus.enabled && weixinStatus.updateAvailable ? (
                            <button className="ghost-link-button primary-action" type="button" onClick={onUpdateWeixin} disabled={weixinBusy}>
                              更新
                            </button>
                          ) : null}
                          {weixinStatus.enabled ? (
                            <button className="ghost-link-button primary-action" type="button" onClick={onLoginWeixin} disabled={weixinBusy}>
                              登录
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <button className="ghost-link-button primary-action" type="button" onClick={onInstallWeixin} disabled={weixinBusy}>
                          安装
                        </button>
                      )}
                    </>
                  ) : null}
                  {connection.docsUrl ? (
                    <a className="ghost-link-button" href={connection.docsUrl} target="_blank" rel="noreferrer">
                      文档
                    </a>
                  ) : null}
                </div>
              </div>
              {isWeixin && weixinMessage ? (
                <div className="qr-login-panel">
                  <div>
                    <strong>WeChat 登录</strong>
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
}: {
  usage: GatewaySessionsUsageResult | null;
  loading: boolean;
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
      {loading ? <div className="inline-page-status">正在统计用量...</div> : null}
      <div className="usage-summary-grid">
        <div className="usage-stat"><span className="usage-icon token-icon" /><div><span>总 Token</span><strong>{formatTokens(resolveTotal(totals))}</strong></div></div>
        <div className="usage-stat"><span className="usage-icon input-icon" /><div><span>输入</span><strong>{formatTokens(totals?.input)}</strong></div></div>
        <div className="usage-stat"><span className="usage-icon output-icon" /><div><span>输出</span><strong>{formatTokens(totals?.output)}</strong></div></div>
        <div className="usage-stat"><span className="usage-icon cache-icon" /><div><span>缓存读</span><strong>{formatTokens(totals?.cacheRead)}</strong></div></div>
        <div className="usage-stat"><span className="usage-icon cache-write-icon" /><div><span>缓存写</span><strong>{formatTokens(totals?.cacheWrite)}</strong></div></div>
        <div className="usage-stat"><span className="usage-icon cost-icon" /><div><span>成本</span><strong>${resolveCost(totals).toFixed(4)}</strong></div></div>
      </div>
      <section className="daily-usage-panel">
        <h2>每天用量</h2>
        <div className="daily-usage-bars">
          {daily.slice(-14).map((day) => (
            <div className="daily-usage-bar" key={day.date}>
              <span>{formatTokens(day.tokens)}</span>
              <div><i style={{ height: `${Math.max(6, (day.tokens / maxDailyTokens) * 100)}%` }} /></div>
              <em>{day.date.slice(5)}</em>
            </div>
          ))}
          {!daily.length ? <div className="empty-panel">暂无每日用量数据。</div> : null}
        </div>
      </section>
      <div className="usage-columns">
        <section>
          <h2>按 Agent</h2>
          {byAgent.map((row) => (
            <div className="usage-row" key={row.agentId}>
              <span>{row.agentId}</span>
              <strong>{formatTokens(resolveTotal(row.totals))}</strong>
            </div>
          ))}
          {!byAgent.length && !loading ? <div className="usage-empty-row">暂无 Agent 用量。</div> : null}
        </section>
        <section>
          <h2>按模型</h2>
          {byModel.map((row, index) => (
            <div className="usage-row" key={`${row.provider ?? "provider"}-${row.model ?? "model"}-${index}`}>
              <span>{[row.provider, row.model].filter(Boolean).join(" / ") || "unknown"}</span>
              <strong>{formatTokens(resolveTotal(row.totals))}</strong>
            </div>
          ))}
          {!byModel.length && !loading ? <div className="usage-empty-row">暂无模型用量。</div> : null}
        </section>
      </div>
      <section className="usage-table-panel">
        <h2>对话</h2>
        {sessions.map((session) => (
          <div className="usage-session-row" key={session.key}>
            <span>{session.label || session.key}</span>
            <span>{session.agentId || "-"}</span>
            <span>{[session.modelProvider, session.model].filter(Boolean).join(" / ") || "-"}</span>
            <strong>{formatTokens(resolveTotal(session.usage ?? undefined))}</strong>
          </div>
        ))}
        {!sessions.length && !loading ? <div className="usage-empty-row">暂无有 Token 消耗的对话。</div> : null}
      </section>
    </section>
  );
}
