import { useCallback, useEffect, useState } from "react";
import type { PluginRepairCard } from "../types/app";
import type { QqbotEditorForm, QqbotExtraAccountRow } from "../lib/qqbotChannelPatch";
import { emptyQqbotEditorForm, validateQqbotEditorForm } from "../lib/qqbotChannelPatch";

type TranslateFn = (key: string) => string;
const tt = (t: TranslateFn, key: string, fallback: string) => {
  const value = t(key);
  return value === key ? fallback : value;
};

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

const CHANNEL_ADD_CLI = 'openclaw channels add --channel qqbot --token "AppID:AppSecret"';

export type QqbotConfigDialogProps = {
  t: TranslateFn;
  open: boolean;
  onClose: () => void;
  gatewayConnected: boolean;
  pluginInstalled: boolean;
  pluginRepairs: PluginRepairCard[];
  loadForm: () => Promise<QqbotEditorForm>;
  onSave: (form: QqbotEditorForm) => void | Promise<void>;
  busy: boolean;
  notice: { text: string; tone: "success" | "error" } | null;
  onInstallPlugin: () => void | Promise<void>;
};

export function QqbotConfigDialog({
  t,
  open,
  onClose,
  gatewayConnected,
  pluginInstalled,
  pluginRepairs,
  loadForm,
  onSave,
  busy,
  notice,
  onInstallPlugin,
}: QqbotConfigDialogProps) {
  const [form, setForm] = useState<QqbotEditorForm>(() => emptyQqbotEditorForm());
  const [loadError, setLoadError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setForm(emptyQqbotEditorForm());
    setLoadError(null);
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    let cancelled = false;
    setLoadError(null);
    void (async () => {
      try {
        const next = await loadForm();
        if (!cancelled) setForm(next);
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : tt(t, "qqbot.loadError", "Failed to load QQ Bot config"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loadForm, reset, t]);

  const updateExtra = useCallback((index: number, patch: Partial<QqbotExtraAccountRow>) => {
    setForm((prev) => {
      const extraAccounts = prev.extraAccounts.map((row, i) => (i === index ? { ...row, ...patch } : row));
      return { ...prev, extraAccounts };
    });
  }, []);

  const addExtraRow = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      extraAccounts: [...prev.extraAccounts, { accountId: "", appId: "", clientSecret: "" }],
    }));
  }, []);

  const removeExtraRow = useCallback((index: number) => {
    setForm((prev) => ({
      ...prev,
      extraAccounts: prev.extraAccounts.filter((_, i) => i !== index),
    }));
  }, []);

  if (!open) return null;

  const disabled = !gatewayConnected || busy;
  const validation = validateQqbotEditorForm(form);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="channel-config-dialog qqbot-config-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qqbot-config-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="qqbot-config-header">
          <h2 id="qqbot-config-title">{tt(t, "qqbot.title", "QQ Bot settings")}</h2>
          <button type="button" className="icon-only-button" onClick={onClose} title={tt(t, "common.close", "Close")} disabled={busy}>
            ×
          </button>
        </div>

        <div className="qqbot-config-scroll">
          {!gatewayConnected ? (
            <p className="qqbot-config-banner warn">{tt(t, "qqbot.gatewayRequired", "Connect Gateway before loading or saving settings.")}</p>
          ) : null}
          {!pluginInstalled ? (
            <p className="qqbot-config-banner warn">
              {tt(t, "qqbot.pluginNotRegistered", "Gateway has not registered the QQ Bot channel yet (usually plugin not installed or not loaded: @openclaw/qqbot). Use Install plugin on the main card first, then return here to save settings.")}
            </p>
          ) : null}
          {loadError ? <p className="qqbot-config-banner warn">{loadError}</p> : null}

          <details className="qqbot-config-guide">
            <summary>{tt(t, "qqbot.guide", "Guide")}</summary>
            <ol>
              <li>
                {tt(t, "qqbot.guide.step1Prefix", "In")}{" "}
                <a href="https://q.qq.com/" target="_blank" rel="noreferrer">
                  {tt(t, "qqbot.qqOpenPlatform", "QQ Open Platform")}
                </a>{" "}
                {tt(t, "qqbot.guide.step1", "create a bot and save its AppID and App Secret before leaving the page.")}
              </li>
              <li>
                {tt(t, "qqbot.guide.step2Prefix", "Install plugin:")} <code>openclaw plugins install @openclaw/qqbot</code>, {tt(t, "qqbot.guide.step2", "then restart Gateway.")}
              </li>
              <li>
                {tt(t, "qqbot.guide.step3", "Session target format:")} <code>qqbot:c2c:OPENID</code> {tt(t, "qqbot.guide.dm", "for DM")}, <code>qqbot:group:GROUP_OPENID</code> {tt(t, "qqbot.guide.group", "for group chat")}, <code>qqbot:channel:CHANNEL_ID</code> {tt(t, "qqbot.guide.channel", "for channel")}.
              </li>
              <li>
                {tt(t, "qqbot.guide.step4Prefix", "Send")} <code>/bot-me</code> {tt(t, "qqbot.guide.step4", "to the bot in QQ to get your OpenID for")} <code>allowFrom</code> / <code>groupAllowFrom</code> {tt(t, "qqbot.guide.config", "config")}.
              </li>
              <li>
                {tt(t, "qqbot.guide.step5Prefix", "For default account, you can use env vars")} <code>QQBOT_APP_ID</code> {tt(t, "qqbot.guide.and", "and")} <code>QQBOT_CLIENT_SECRET</code>. {tt(t, "qqbot.guide.step5", "For multi-account, see")}{" "}
                <a href="https://docs.openclaw.ai/channels/qqbot" target="_blank" rel="noreferrer">
                  {tt(t, "qqbot.officialDocs", "official docs")}
                </a>
                .
              </li>
            </ol>
            <div className="qqbot-config-cli-actions">
              <button type="button" className="ghost-link-button" onClick={() => void copyToClipboard("openclaw plugins install @openclaw/qqbot")}>
                {tt(t, "qqbot.copyInstall", "Copy install command")}
              </button>
              <button type="button" className="ghost-link-button" onClick={() => void copyToClipboard(CHANNEL_ADD_CLI)}>
                {tt(t, "qqbot.copyAddExample", "Copy channels add example")}
              </button>
              {!pluginInstalled ? (
                <button type="button" className="ghost-link-button primary-action" onClick={() => void onInstallPlugin()}>
                  {tt(t, "qqbot.openInstallTerminal", "Open terminal to install plugin")}
                </button>
              ) : null}
            </div>
          </details>

          <h3 className="qqbot-config-section-title">{tt(t, "qqbot.defaultAccount", "Default account")}</h3>
          <div className="qqbot-config-grid">
            <label>
              <span>AppID</span>
              <input
                value={form.defaultAppId}
                onChange={(e) => setForm((p) => ({ ...p, defaultAppId: e.target.value }))}
                placeholder={tt(t, "qqbot.placeholder.appId", "QQ Open Platform bot AppID")}
                disabled={disabled}
                autoComplete="off"
              />
            </label>
            <label>
              <span>Client Secret</span>
              <input
                type="password"
                value={form.defaultClientSecret}
                onChange={(e) => setForm((p) => ({ ...p, defaultClientSecret: e.target.value }))}
                placeholder={tt(t, "qqbot.placeholder.secret", "Leave empty to keep existing saved secret")}
                disabled={disabled}
                autoComplete="new-password"
              />
            </label>
          </div>

          <h3 className="qqbot-config-section-title">{tt(t, "qqbot.subAccounts", "Sub accounts")}</h3>
          <p className="qqbot-config-hint">{tt(t, "qqbot.subHint", "Each sub-account maps to channels.qqbot.accounts.<id>. Fill account ID and AppID in each row; leave Secret empty to preserve existing value.")}</p>
          <div className="qqbot-extra-list">
            {form.extraAccounts.map((row, index) => (
              <div className="qqbot-extra-row" key={`extra-${String(index)}`}>
                <input
                  value={row.accountId}
                  onChange={(e) => updateExtra(index, { accountId: e.target.value })}
                  placeholder={tt(t, "qqbot.placeholder.accountId", "Account ID")}
                  disabled={disabled}
                />
                <input
                  value={row.appId}
                  onChange={(e) => updateExtra(index, { appId: e.target.value })}
                  placeholder="AppID"
                  disabled={disabled}
                />
                <input
                  type="password"
                  value={row.clientSecret}
                  onChange={(e) => updateExtra(index, { clientSecret: e.target.value })}
                  placeholder="Client Secret"
                  disabled={disabled}
                />
                <button type="button" className="ghost-link-button danger-action" onClick={() => removeExtraRow(index)} disabled={disabled}>
                  {tt(t, "common.remove", "Remove")}
                </button>
              </div>
            ))}
            <button type="button" className="ghost-link-button" onClick={addExtraRow} disabled={disabled}>
              {tt(t, "qqbot.addSubAccount", "Add sub-account row")}
            </button>
          </div>

          <h3 className="qqbot-config-section-title">{tt(t, "qqbot.groupPolicy", "Group policy")}</h3>
          <label className="qqbot-config-checkbox">
            <input
              type="checkbox"
              checked={form.applyGroupSettings}
              onChange={(e) => setForm((p) => ({ ...p, applyGroupSettings: e.target.checked }))}
              disabled={disabled}
            />
            <span>{tt(t, "qqbot.writeGroupOptions", "Write the options below into config (channels.qqbot.groupPolicy and groups[\"*\"]).")}</span>
          </label>
          {form.applyGroupSettings ? (
            <div className="qqbot-config-grid qqbot-config-grid-wide">
              <label>
                <span>groupPolicy</span>
                <select
                  value={form.groupPolicy}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      groupPolicy: e.target.value as QqbotEditorForm["groupPolicy"],
                    }))
                  }
                  disabled={disabled}
                >
                  <option value="">{tt(t, "common.pleaseSelect", "Please select")}</option>
                  <option value="allowlist">allowlist ({tt(t, "common.recommended", "recommended")})</option>
                  <option value="open">open</option>
                  <option value="disabled">disabled</option>
                </select>
              </label>
              <label className="qqbot-config-span-2">
                <span>{tt(t, "qqbot.groupAllowFrom", "groupAllowFrom (one OpenID per line)")}</span>
                <textarea
                  value={form.groupAllowFromLines}
                  onChange={(e) => setForm((p) => ({ ...p, groupAllowFromLines: e.target.value }))}
                  rows={4}
                  placeholder={tt(t, "qqbot.placeholder.groupAllowFrom", "Example: member OpenID, one per line")}
                  disabled={disabled}
                />
              </label>
              <label className="qqbot-config-checkbox">
                <input
                  type="checkbox"
                  checked={form.groupsStarRequireMention}
                  onChange={(e) => setForm((p) => ({ ...p, groupsStarRequireMention: e.target.checked }))}
                  disabled={disabled}
                />
                <span>{tt(t, "qqbot.requireMention", "Group default: require @mention before replying (requireMention)")}</span>
              </label>
              <label>
                <span>{tt(t, "qqbot.historyLimit", "Group default historyLimit")}</span>
                <input
                  value={form.groupsStarHistoryLimit}
                  onChange={(e) => setForm((p) => ({ ...p, groupsStarHistoryLimit: e.target.value }))}
                  placeholder="50"
                  disabled={disabled}
                />
              </label>
              <label>
                <span>{tt(t, "qqbot.toolPolicy", "Group default toolPolicy")}</span>
                <select
                  value={form.groupsStarToolPolicy}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      groupsStarToolPolicy: e.target.value as QqbotEditorForm["groupsStarToolPolicy"],
                    }))
                  }
                  disabled={disabled}
                >
                  <option value="">{tt(t, "qqbot.doNotWrite", "Do not write")}</option>
                  <option value="full">full</option>
                  <option value="restricted">restricted</option>
                  <option value="none">none</option>
                </select>
              </label>
            </div>
          ) : null}

          {pluginRepairs.length ? (
            <div className="qqbot-config-repairs">
              <strong>{tt(t, "connections.pluginDiagnostics", "Plugin diagnostics")}</strong>
              <ul>
                {pluginRepairs.map((card, i) => (
                  <li key={`${card.pluginId}-${i}`}>
                    {card.headlineZh} — {card.bodyZh}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {notice ? (
            <p className={notice.tone === "success" ? "qqbot-channel-success" : "qqbot-config-banner warn"}>{notice.text}</p>
          ) : null}
          {validation ? <p className="qqbot-config-banner warn">{validation}</p> : null}
        </div>

        <div className="qqbot-config-footer">
          <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>
            {tt(t, "common.cancel", "Cancel")}
          </button>
          <button
            type="button"
            className="primary-action-button"
            disabled={disabled || Boolean(validation)}
            onClick={() => {
              void onSave(form);
            }}
          >
            {busy ? tt(t, "common.saving", "Saving...") : tt(t, "qqbot.saveToOpenClaw", "Save to OpenClaw")}
          </button>
        </div>
      </section>
    </div>
  );
}
