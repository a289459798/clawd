import { useMemo, useState } from "react";
import type { ChannelConnection, Skill } from "../types/app";
import type { GatewaySessionsUsageResult, GatewayUsageTotals } from "../types/gateway";

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

const connectionRank: Record<ChannelConnection["status"], number> = {
  connected: 0,
  warning: 1,
  disabled: 2,
};

const channelConfigFields: Record<string, Array<{ key: string; label: string; secret?: boolean }>> = {
  feishu: [
    { key: "enabled", label: "启用" },
    { key: "appId", label: "App ID" },
    { key: "appSecret", label: "App Secret", secret: true },
    { key: "verificationToken", label: "Verification Token", secret: true },
    { key: "encryptKey", label: "Encrypt Key", secret: true },
    { key: "groupPolicy", label: "群聊策略" },
  ],
  "openclaw-weixin": [
    { key: "enabled", label: "启用" },
    { key: "accountId", label: "账号 ID" },
    { key: "stateDir", label: "登录状态目录" },
  ],
  whatsapp: [
    { key: "enabled", label: "启用" },
    { key: "sessionDir", label: "会话状态目录" },
    { key: "dmPolicy", label: "私聊策略" },
  ],
  telegram: [
    { key: "enabled", label: "启用" },
    { key: "botToken", label: "Bot Token", secret: true },
    { key: "groupPolicy", label: "群聊策略" },
  ],
  discord: [
    { key: "enabled", label: "启用" },
    { key: "botToken", label: "Bot Token", secret: true },
    { key: "applicationId", label: "Application ID" },
  ],
  slack: [
    { key: "enabled", label: "启用" },
    { key: "botToken", label: "Bot Token", secret: true },
    { key: "appToken", label: "App Token", secret: true },
    { key: "signingSecret", label: "Signing Secret", secret: true },
  ],
};

function getChannelFields(id: string) {
  return channelConfigFields[id] ?? [
    { key: "enabled", label: "启用" },
    { key: "accountId", label: "账号 ID" },
    { key: "allowFrom", label: "允许来源" },
  ];
}

export function SkillsPage({
  skills,
  loading,
  onToggleSkill,
}: {
  skills: Skill[];
  loading: boolean;
  onToggleSkill: (skillId: string, enabled: boolean) => void;
}) {
  return (
    <section className="single-page">
      {loading ? <div className="inline-page-status">正在同步技能状态...</div> : null}
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
  loading,
  qrDataUrl,
  qrMessage,
  onWeixinLogin,
}: {
  connections: ChannelConnection[];
  connectionLabel: Record<ChannelConnection["status"], string>;
  loading: boolean;
  qrDataUrl: string | null;
  qrMessage: string | null;
  onWeixinLogin: () => void;
}) {
  const [configuring, setConfiguring] = useState<(ChannelConnection & { docsUrl?: string; packageName?: string }) | null>(null);
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
      <div className="connection-list-panel">
        {rows.map((connection) => (
          <article className="info-card connection-card" key={connection.id}>
            <div className="card-row">
              <div>
                <strong>{connection.name}</strong>
                <span className="connection-config-key">{connection.config}</span>
              </div>
              <span className={`toggle-badge ${connection.status}`}>{connectionLabel[connection.status]}</span>
            </div>
            <p>{connection.detail}</p>
            {connection.accounts?.length ? (
              <div className="connection-accounts">
                {connection.accounts.map((account) => (
                  <span key={account.accountId}>
                    {account.name || account.accountId} · {account.connected ? "已连接" : account.configured ? "已配置" : "待配置"}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="connection-actions-row">
              <span>{connection.activity}</span>
              <div>
                {connection.packageName ? <code>{connection.packageName}</code> : null}
                <button className="ghost-button tiny-button" type="button" onClick={() => setConfiguring(connection)}>
                  配置
                </button>
                {connection.id === "openclaw-weixin" ? (
                  <button className="ghost-button tiny-button" type="button" onClick={onWeixinLogin}>
                    查看二维码
                  </button>
                ) : null}
                {connection.docsUrl ? (
                  <a className="ghost-link-button" href={connection.docsUrl} target="_blank" rel="noreferrer">
                    文档
                  </a>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
      {qrDataUrl || qrMessage ? (
        <div className="qr-login-panel">
          <div>
            <strong>微信扫码登录</strong>
            <p>{qrMessage || "请使用微信扫描二维码完成插件登录。"}</p>
          </div>
          {qrDataUrl ? <img src={qrDataUrl} alt="微信登录二维码" /> : null}
        </div>
      ) : null}
      {configuring ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setConfiguring(null)}>
          <section className="channel-config-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="agent-create-header">
              <div>
                <h2>{configuring.name} 配置</h2>
                <span>{configuring.config}</span>
              </div>
              <button className="icon-only-button" type="button" onClick={() => setConfiguring(null)} title="关闭">×</button>
            </div>
            <div className="channel-config-body">
              {getChannelFields(configuring.id).map((field) => (
                <label key={field.key}>
                  <span>{field.label}</span>
                  <input type={field.secret ? "password" : "text"} placeholder={`${configuring.config}.${field.key}`} />
                </label>
              ))}
              {configuring.id === "openclaw-weixin" ? (
                <div className="channel-config-note">
                  需要安装 <code>@tencent-weixin/openclaw-weixin</code>，安装后可通过二维码登录。
                </div>
              ) : null}
            </div>
            <div className="agent-create-actions">
              {configuring.docsUrl ? (
                <a className="ghost-link-button" href={configuring.docsUrl} target="_blank" rel="noreferrer">查看文档</a>
              ) : null}
              <button className="primary-action-button" type="button" onClick={() => setConfiguring(null)}>完成</button>
            </div>
          </section>
        </div>
      ) : null}
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
