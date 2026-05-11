import { useEffect, useState } from "react";
import type { FeishuAccountRow, FeishuEditorForm } from "../lib/feishuChannelPatch";
import { emptyFeishuEditorForm, validateFeishuEditorForm } from "../lib/feishuChannelPatch";

type TranslateFn = (key: string) => string;
const tt = (t: TranslateFn, key: string, fallback: string) => {
  const value = t(key);
  return value === key ? fallback : value;
};

export type FeishuConfigDialogProps = {
  t: TranslateFn;
  open: boolean;
  onClose: () => void;
  gatewayConnected: boolean;
  loadForm: () => Promise<FeishuEditorForm>;
  onSave: (form: FeishuEditorForm) => void | Promise<void>;
  busy: boolean;
  notice: { text: string; tone: "success" | "error" } | null;
};

export function FeishuConfigDialog({
  t,
  open,
  onClose,
  gatewayConnected,
  loadForm,
  onSave,
  busy,
  notice,
}: FeishuConfigDialogProps) {
  const [form, setForm] = useState<FeishuEditorForm>(() => emptyFeishuEditorForm());
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setForm(emptyFeishuEditorForm());
      setLoadError(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const next = await loadForm();
        if (!cancelled) setForm(next);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : tt(t, "channelConfig.loadError", "Failed to load channel config"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loadForm]);

  if (!open) return null;
  const disabled = !gatewayConnected || busy;
  const validation = validateFeishuEditorForm(form);

  const updateRow = (index: number, patch: Partial<FeishuAccountRow>) => {
    setForm((prev) => ({
      ...prev,
      accounts: prev.accounts.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="channel-config-dialog qqbot-config-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feishu-config-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="qqbot-config-header">
          <h2 id="feishu-config-title">{tt(t, "feishu.title", "Feishu settings")}</h2>
          <button type="button" className="icon-only-button" onClick={onClose} title={tt(t, "common.close", "Close")} disabled={busy}>
            ×
          </button>
        </div>

        <div className="qqbot-config-scroll">
          {!gatewayConnected ? (
            <p className="qqbot-config-banner warn">{tt(t, "channelConfig.gatewayRequired", "Connect Gateway before loading or saving settings.")}</p>
          ) : null}
          {loadError ? <p className="qqbot-config-banner warn">{loadError}</p> : null}

          <details className="qqbot-config-guide">
            <summary>{tt(t, "common.guide", "Guide")}</summary>
            <ol>
              <li>
                {tt(t, "feishu.guide.1", "Open your bot app in Feishu Open Platform first.")}{" "}
                <a href="https://open.feishu.cn/app" target="_blank" rel="noreferrer">
                  {tt(t, "common.open", "Open")}
                </a>
              </li>
              <li>
                {tt(t, "feishu.guide.2", "Go to Credentials and Basic Info, then copy App ID and App Secret.")}{" "}
                <a href="https://open.feishu.cn/app" target="_blank" rel="noreferrer">
                  {tt(t, "feishu.guide.credentialsLink", "Open app console")}
                </a>
              </li>
              <li>
                {tt(t, "feishu.guide.3", "Go to Events & Permissions and enable message-related permissions.")}{" "}
                <a href="https://open.feishu.cn/app" target="_blank" rel="noreferrer">
                  {tt(t, "feishu.guide.permissionsLink", "Open permissions")}
                </a>
              </li>
              <li>{tt(t, "feishu.guide.4", "Return to ClawKit connections and finish the form in Configure.")}</li>
            </ol>
          </details>

          <h3 className="qqbot-config-section-title">{tt(t, "channelConfig.basic", "Basic settings")}</h3>
          <div className="qqbot-config-grid">
            <label>
              <span>{tt(t, "feishu.defaultAccount", "Default account ID")}</span>
              <input
                value={form.defaultAccount}
                onChange={(e) => setForm((p) => ({ ...p, defaultAccount: e.target.value }))}
                disabled={disabled}
                placeholder="default"
              />
            </label>
            <label>
              <span>{tt(t, "feishu.dmPolicy", "DM policy")}</span>
              <select
                value={form.dmPolicy}
                onChange={(e) => setForm((p) => ({ ...p, dmPolicy: e.target.value as FeishuEditorForm["dmPolicy"] }))}
                disabled={disabled}
              >
                <option value="allowlist">allowlist</option>
                <option value="pairing">pairing</option>
                <option value="open">open</option>
                <option value="disabled">disabled</option>
              </select>
            </label>
            <label>
              <span>{tt(t, "feishu.groupPolicy", "Group policy")}</span>
              <select
                value={form.groupPolicy}
                onChange={(e) => setForm((p) => ({ ...p, groupPolicy: e.target.value as FeishuEditorForm["groupPolicy"] }))}
                disabled={disabled}
              >
                <option value="allowlist">allowlist</option>
                <option value="open">open</option>
                <option value="disabled">disabled</option>
              </select>
            </label>
            <label className="qqbot-config-checkbox">
              <input
                type="checkbox"
                checked={form.requireMention}
                onChange={(e) => setForm((p) => ({ ...p, requireMention: e.target.checked }))}
                disabled={disabled}
              />
              <span>{tt(t, "feishu.requireMention", "Reply only when bot is @mentioned in groups")}</span>
            </label>
            <label>
              <span>{tt(t, "feishu.domain", "Domain")}</span>
              <select
                value={form.domain}
                onChange={(e) => setForm((p) => ({ ...p, domain: e.target.value as FeishuEditorForm["domain"] }))}
                disabled={disabled}
              >
                <option value="feishu">feishu</option>
                <option value="lark">lark</option>
              </select>
            </label>
            <label>
              <span>{tt(t, "feishu.connectionMode", "Connection mode")}</span>
              <select
                value={form.connectionMode}
                onChange={(e) => setForm((p) => ({ ...p, connectionMode: e.target.value as FeishuEditorForm["connectionMode"] }))}
                disabled={disabled}
              >
                <option value="websocket">websocket</option>
                <option value="webhook">webhook</option>
              </select>
            </label>
            <label className="qqbot-config-span-2">
              <span>{tt(t, "feishu.allowFrom", "Allowed DM users (one ou_xxx per line)")}</span>
              <textarea
                value={form.allowFromLines}
                onChange={(e) => setForm((p) => ({ ...p, allowFromLines: e.target.value }))}
                rows={3}
                disabled={disabled}
              />
            </label>
            <label className="qqbot-config-span-2">
              <span>{tt(t, "feishu.groupAllowFrom", "Group allowlist (one oc_xxx per line)")}</span>
              <textarea
                value={form.groupAllowFromLines}
                onChange={(e) => setForm((p) => ({ ...p, groupAllowFromLines: e.target.value }))}
                rows={3}
                disabled={disabled}
              />
            </label>
          </div>

          <h3 className="qqbot-config-section-title">{tt(t, "channelConfig.accounts", "Bot accounts")}</h3>
          <p className="qqbot-config-hint">{tt(t, "feishu.accountsHint", "Configure single-bot or multi-bot accounts. Fill App ID when you provide App Secret.")}</p>
          <div className="qqbot-extra-list">
            {form.accounts.map((row, index) => (
              <div className="qqbot-extra-row" key={`feishu-${index}`}>
                <input
                  value={row.accountId}
                  onChange={(e) => updateRow(index, { accountId: e.target.value })}
                  disabled={disabled}
                  placeholder={tt(t, "channelConfig.accountId", "Account ID")}
                />
                <input
                  value={row.appId}
                  onChange={(e) => updateRow(index, { appId: e.target.value })}
                  disabled={disabled}
                  placeholder={tt(t, "channelConfig.appId", "App ID")}
                />
                <input
                  type="password"
                  value={row.appSecret}
                  onChange={(e) => updateRow(index, { appSecret: e.target.value })}
                  disabled={disabled}
                  placeholder={tt(t, "channelConfig.appSecret", "App Secret (leave empty to keep unchanged)")}
                />
                <button
                  type="button"
                  className="ghost-link-button danger-action"
                  disabled={disabled}
                  onClick={() => setForm((p) => ({ ...p, accounts: p.accounts.filter((_, i) => i !== index) }))}
                >
                  {tt(t, "common.remove", "Remove")}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="ghost-link-button"
              disabled={disabled}
              onClick={() => setForm((p) => ({ ...p, accounts: [...p.accounts, { accountId: "", name: "", enabled: true, appId: "", appSecret: "" }] }))}
            >
              {tt(t, "common.add", "Add")}
            </button>
          </div>

          {notice ? (
            <p className={notice.tone === "success" ? "qqbot-channel-success" : "qqbot-config-banner warn"}>{notice.text}</p>
          ) : null}
          {validation ? <p className="qqbot-config-banner warn">{validation}</p> : null}
        </div>

        <div className="qqbot-config-footer">
          <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>
            {tt(t, "common.cancel", "Cancel")}
          </button>
          <button type="button" className="primary-action-button" disabled={disabled || Boolean(validation)} onClick={() => void onSave(form)}>
            {busy ? tt(t, "common.saving", "Saving...") : tt(t, "common.save", "Save")}
          </button>
        </div>
      </section>
    </div>
  );
}

