import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChannelConnection, PluginRepairCard, QqbotPluginStatus, Skill, SkillPolicyHint, WeixinPluginStatus } from "../types/app";
import type { FeishuEditorForm } from "../lib/feishuChannelPatch";
import { formatFileSize } from "../lib/fileDisplay";
import type { QqbotEditorForm } from "../lib/qqbotChannelPatch";
import { FeishuConfigDialog } from "./FeishuConfigDialog";
import { QqbotConfigDialog } from "./QqbotConfigDialog";
import type { GatewayChannelsEventLoopHealth, GatewayConfigGetResult, GatewaySessionsUsageResult, GatewayUsageTotals } from "../types/gateway";
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

const SKILL_UPLOAD_CHUNK_SIZE = 256 * 1024;

function normalizeSkillSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.zip$/i, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function bytesToBase64(bytes: Uint8Array) {
  let out = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(out);
}

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readAllowUploadedArchives(config: unknown) {
  if (!config || typeof config !== "object") return false;
  const skills = (config as Record<string, unknown>).skills;
  if (!skills || typeof skills !== "object") return false;
  const install = (skills as Record<string, unknown>).install;
  if (!install || typeof install !== "object") return false;
  return (install as Record<string, unknown>).allowUploadedArchives === true;
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
  onRefreshSkills,
  onOpenUploadSettings,
}: {
  skills: Skill[];
  pluginLoadRepairs: PluginRepairCard[];
  loading: boolean;
  t: TranslateFn;
  onToggleSkill: (skillId: string, enabled: boolean) => void;
  onRefreshSkills: () => void | Promise<void>;
  onOpenUploadSettings: () => void;
}) {
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadSlug, setUploadSlug] = useState("");
  const [uploadForce, setUploadForce] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadConfirmOpen, setUploadConfirmOpen] = useState(false);
  const [zipUploadAllowed, setZipUploadAllowed] = useState<boolean | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setZipUploadAllowed(null);
    void (async () => {
      try {
        await invoke("gateway_connect");
        const result = await invoke<GatewayConfigGetResult>("gateway_config_get");
        if (cancelled) return;
        setZipUploadAllowed(readAllowUploadedArchives(result.config));
      } catch {
        if (!cancelled) setZipUploadAllowed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUploadFileChange = (file: File | null) => {
    setUploadFile(file);
    setUploadMessage(null);
    setUploadError(null);
    if (file && !uploadSlug.trim()) {
      setUploadSlug(normalizeSkillSlug(file.name));
    }
  };

  const installUploadedSkill = async (confirmed = false) => {
    if (zipUploadAllowed !== true) {
      setUploadError(tt(t, "skills.upload.disabledByConfig", "Zip uploads are not enabled yet. Turn on Allow zip uploads in Settings > OpenClaw, then retry."));
      return;
    }
    if (!uploadFile) {
      setUploadError(tt(t, "skills.upload.selectZipFirst", "Choose a zip file first."));
      return;
    }
    const slug = normalizeSkillSlug(uploadSlug || uploadFile.name);
    if (!slug) {
      setUploadError(tt(t, "skills.upload.slugRequired", "Enter a skill name before installing."));
      return;
    }
    if (!uploadFile.name.toLowerCase().endsWith(".zip")) {
      setUploadError(tt(t, "skills.upload.zipOnly", "Only .zip skill archives are supported."));
      return;
    }
    if (!confirmed) {
      setUploadConfirmOpen(true);
      return;
    }

    setUploadConfirmOpen(false);
    setUploadBusy(true);
    setUploadError(null);
    setUploadMessage(tt(t, "skills.upload.hashing", "Checking archive..."));
    try {
      await invoke("gateway_connect");
      const buffer = await uploadFile.arrayBuffer();
      const sha256 = await sha256Hex(buffer);
      const begin = await invoke<{ uploadId?: string }>("gateway_skills_upload_begin", {
        params: {
          kind: "skill-archive",
          slug,
          sizeBytes: uploadFile.size,
          sha256,
          force: uploadForce,
          idempotencyKey: `clawkit-${Date.now()}-${slug}`,
        },
      });
      const uploadId = begin.uploadId;
      if (!uploadId) {
        throw new Error(tt(t, "skills.upload.noUploadId", "Gateway did not return an upload id."));
      }

      const bytes = new Uint8Array(buffer);
      for (let offset = 0; offset < bytes.length; offset += SKILL_UPLOAD_CHUNK_SIZE) {
        setUploadMessage(
          tt(t, "skills.upload.uploading", "Uploading archive...")
            .replace("{{percent}}", `${Math.min(99, Math.floor((offset / Math.max(bytes.length, 1)) * 100))}%`),
        );
        await invoke("gateway_skills_upload_chunk", {
          params: {
            uploadId,
            offset,
            dataBase64: bytesToBase64(bytes.subarray(offset, offset + SKILL_UPLOAD_CHUNK_SIZE)),
          },
        });
      }

      setUploadMessage(tt(t, "skills.upload.installing", "Installing skill..."));
      await invoke("gateway_skills_upload_commit", { params: { uploadId, sha256 } });
      await invoke("gateway_skills_install_upload", {
        params: {
          uploadId,
          slug,
          force: uploadForce,
          sha256,
          timeoutMs: 120_000,
        },
      });
      setUploadMessage(tt(t, "skills.upload.done", "Skill installed. Refreshing list..."));
      setUploadFile(null);
      setUploadSlug("");
      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
      await onRefreshSkills();
      setUploadMessage(tt(t, "skills.upload.doneShort", "Skill installed."));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setUploadError(message.includes("allowUploadedArchives")
        ? tt(t, "skills.upload.disabledByConfig", "Zip uploads are not enabled yet. Turn on Allow zip uploads in Settings > OpenClaw, then retry.")
        : message);
    } finally {
      setUploadBusy(false);
    }
  };

  return (
    <section className="single-page">
      {loading ? <div className="inline-page-status">{tt(t, "skills.loading", "Syncing skill status...")}</div> : null}
      <PluginRepairStack title={tt(t, "skills.pluginRuntimeIssues", "Plugin runtime load issues (from Gateway health)")} items={pluginLoadRepairs} t={t} />
      {zipUploadAllowed === true ? (
      <article className="info-card skill-upload-card">
        <div className="skill-upload-head">
          <div>
            <strong>{tt(t, "skills.upload.title", "Install skill from zip")}</strong>
            <p>{tt(t, "skills.upload.description", "Choose a skill zip archive. ClawKit will upload it through OpenClaw Gateway and install it into the default skills folder.")}</p>
          </div>
          <span className="skill-upload-trust-badge">{tt(t, "skills.upload.trustedOnly", "Only use archives you trust")}</span>
        </div>

        <div className="skill-upload-body">
          <button
            className={`skill-upload-dropzone ${uploadFile ? "has-file" : ""} ${uploadDragActive ? "drag-active" : ""}`}
            type="button"
            disabled={uploadBusy}
            onClick={() => uploadInputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              if (!uploadBusy) setUploadDragActive(true);
            }}
            onDragLeave={() => setUploadDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setUploadDragActive(false);
              if (uploadBusy) return;
              handleUploadFileChange(event.dataTransfer.files?.[0] ?? null);
            }}
          >
            <span className="skill-upload-drop-icon" aria-hidden="true">ZIP</span>
            <span className="skill-upload-drop-copy">
              <strong>{uploadFile ? uploadFile.name : tt(t, "skills.upload.chooseFile", "Choose zip archive")}</strong>
              <small>
                {uploadFile
                  ? `${formatFileSize(uploadFile.size)} · ${tt(t, "skills.upload.clickToReplace", "Click to choose another file")}`
                  : tt(t, "skills.upload.dropHint", "Click to choose a file, or drop it here")}
              </small>
            </span>
          </button>
          <input
            ref={uploadInputRef}
            className="skill-upload-native-input"
            type="file"
            accept=".zip,application/zip"
            disabled={uploadBusy}
            onChange={(event) => handleUploadFileChange(event.target.files?.[0] ?? null)}
          />

          <div className="skill-upload-settings">
            <label>
              <span>{tt(t, "skills.upload.slug", "Skill name")}</span>
              <input
                type="text"
                value={uploadSlug}
                disabled={uploadBusy}
                placeholder={tt(t, "skills.upload.slugPlaceholder", "for example: my-skill")}
                onChange={(event) => setUploadSlug(event.target.value)}
              />
            </label>
            <label className="skill-upload-force">
              <input
                type="checkbox"
                checked={uploadForce}
                disabled={uploadBusy}
                onChange={(event) => setUploadForce(event.target.checked)}
              />
              <span>{tt(t, "skills.upload.force", "Replace existing skill with the same name")}</span>
            </label>
          </div>
        </div>

        <div className="skill-upload-footer">
          <div className="skill-upload-status">
            {uploadMessage ? <div className="inline-page-status">{uploadMessage}</div> : null}
            {uploadError ? <div className="inline-page-status danger">{uploadError}</div> : null}
          </div>
          <button className="primary-button compact" type="button" onClick={() => void installUploadedSkill()} disabled={uploadBusy || !uploadFile}>
            {uploadBusy ? tt(t, "skills.upload.busy", "Installing...") : tt(t, "skills.upload.action", "Upload and install")}
          </button>
        </div>
        {uploadConfirmOpen ? (
          <div className="modal-backdrop skill-upload-confirm-backdrop" role="presentation" onMouseDown={() => setUploadConfirmOpen(false)}>
            <section className="skill-upload-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-upload-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="skill-upload-confirm-head">
                <strong id="skill-upload-confirm-title">{tt(t, "skills.upload.confirmTitle", "Install this skill?")}</strong>
                <button type="button" onClick={() => setUploadConfirmOpen(false)} aria-label={tt(t, "common.close", "Close")}>×</button>
              </div>
              <div className="skill-upload-confirm-body">
                <p>{tt(t, "skills.upload.confirmBody", "Skill archives can contain code that runs on this computer. Only continue if you trust the source.")}</p>
                {uploadFile ? (
                  <div className="skill-upload-confirm-file">
                    <span>ZIP</span>
                    <div>
                      <strong>{uploadFile.name}</strong>
                      <small>{formatFileSize(uploadFile.size)} · {normalizeSkillSlug(uploadSlug || uploadFile.name)}</small>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="skill-upload-confirm-actions">
                <button className="ghost-button" type="button" onClick={() => setUploadConfirmOpen(false)}>{tt(t, "common.cancel", "Cancel")}</button>
                <button className="primary-button compact" type="button" onClick={() => void installUploadedSkill(true)}>{tt(t, "skills.upload.confirmAction", "Install trusted zip")}</button>
              </div>
            </section>
          </div>
        ) : null}
      </article>
      ) : (
        <article className="info-card skill-upload-card skill-upload-disabled-card">
          <div className="skill-upload-head">
            <div>
              <strong>{tt(t, "skills.upload.title", "Install skill from zip")}</strong>
              <p>
                {zipUploadAllowed === null
                  ? tt(t, "skills.upload.checkingConfig", "Checking whether zip uploads are enabled...")
                  : tt(t, "skills.upload.disabledNotice", "Zip upload is turned off. Enable it in Settings > OpenClaw when you need to install a trusted private skill archive.")}
              </p>
            </div>
            <span className="skill-upload-trust-badge disabled">{tt(t, "common.disabled", "Disabled")}</span>
          </div>
          {zipUploadAllowed === false ? (
            <div className="skill-upload-disabled-actions">
              <button className="ghost-button" type="button" onClick={onOpenUploadSettings}>
                {tt(t, "skills.upload.openSettings", "Open Settings")}
              </button>
            </div>
          ) : null}
        </article>
      )}
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
  feishuBusy,
  feishuNotice,
  onLoadFeishuEditorForm,
  onSaveFeishuSettings,
  onDismissFeishuNotice,
  onRefreshFeishuStatus,
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
  feishuBusy: boolean;
  feishuNotice: { text: string; tone: "success" | "error" } | null;
  onLoadFeishuEditorForm: () => Promise<FeishuEditorForm>;
  onSaveFeishuSettings: (form: FeishuEditorForm) => void | Promise<void>;
  onDismissFeishuNotice?: () => void;
  onRefreshFeishuStatus: () => void | Promise<void>;
}) {
  const [qqbotDialogOpen, setQqbotDialogOpen] = useState(false);
  const [feishuDialogOpen, setFeishuDialogOpen] = useState(false);
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
          const isFeishu = connection.id === "feishu";
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
              ) : isFeishu ? (
                <p className="connection-qqbot-summary">
                  {!gatewayConnected
                    ? tt(t, "connections.feishu.gatewayDisconnected", "Gateway is disconnected. Cannot load or save settings right now.")
                    : tt(t, "connections.feishu.cardHint", "Use Configure to manage app credentials, DM policy, and group policy.")}
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
                  {isFeishu ? (
                    <>
                      <button
                        className="ghost-link-button"
                        type="button"
                        onClick={() => void onRefreshFeishuStatus()}
                        disabled={loading}
                      >
                        {loading ? tt(t, "common.checking", "Checking") : tt(t, "common.refresh", "Refresh")}
                      </button>
                      <button
                        className="ghost-link-button primary-action"
                        type="button"
                        onClick={() => {
                          onDismissFeishuNotice?.();
                          setFeishuDialogOpen(true);
                        }}
                      >
                        {tt(t, "common.configure", "Configure")}
                      </button>
                      <FeishuConfigDialog
                        t={t}
                        open={feishuDialogOpen}
                        onClose={() => {
                          setFeishuDialogOpen(false);
                          onDismissFeishuNotice?.();
                        }}
                        gatewayConnected={gatewayConnected}
                        loadForm={onLoadFeishuEditorForm}
                        onSave={onSaveFeishuSettings}
                        busy={feishuBusy}
                        notice={feishuNotice}
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
