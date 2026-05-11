import { useEffect, useMemo, useState } from "react";
import type { GatewayModelAuthStatusProfile, GatewayModelAuthStatusResult, GatewayModelSummary } from "../types/gateway";

type TranslateFn = (key: string) => string;
const tt = (t: TranslateFn, key: string, fallback: string) => {
  const value = t(key);
  return value === key ? fallback : value;
};

type ModelConfigDraft = {
  provider: string;
  modelId: string;
  alias: string;
  setDefault: boolean;
};

type ProviderConfigDraft = {
  provider: string;
  apiKey: string;
  baseUrl: string;
};

type ModelsPageProps = {
  t: TranslateFn;
  configuredModels: GatewayModelSummary[];
  allModels: GatewayModelSummary[];
  authStatus: GatewayModelAuthStatusResult | null;
  loading: boolean;
  currentDefaultModel?: string | null;
  actionBusy: boolean;
  message: string | null;
  onRefresh: () => void;
  onSetDefault: (modelRef: string) => void;
  onAuthProvider: (provider: string, setDefault: boolean) => void;
  onSaveProviderConfig: (draft: ProviderConfigDraft) => void;
  onSaveModelConfig: (draft: ModelConfigDraft) => void;
};

type ModelRow = GatewayModelSummary & {
  ref: string;
  provider: string;
  modelId: string;
  displayName: string;
  configured: boolean;
};

const oauthProviderLabels: Record<string, string> = {
  "openai-codex": "ChatGPT / Codex OAuth",
  "google-gemini-cli": "Gemini CLI OAuth",
  "github-copilot": "GitHub Copilot OAuth",
  "anthropic": "Claude CLI / OAuth",
};

function qualifyModelRef(model: GatewayModelSummary) {
  const explicit = model.ref?.trim();
  if (explicit) return explicit;
  const key = model.key?.trim();
  if (key) return key;
  const id = model.id.trim();
  const provider = model.provider?.trim();
  if (!provider || id.includes("/")) return id;
  return `${provider}/${id}`;
}

function splitModelRef(model: GatewayModelSummary) {
  const ref = qualifyModelRef(model);
  const provider = model.provider?.trim() || ref.split("/")[0] || "unknown";
  const modelId = ref.startsWith(`${provider}/`) ? ref.slice(provider.length + 1) : model.id;
  return { ref, provider, modelId };
}

function normalize(value?: string | null) {
  return (value ?? "").trim().toLowerCase();
}

function profileCredentialLabel(type: GatewayModelAuthStatusProfile["type"]) {
  if (type === "oauth") return "OAuth";
  if (type === "token") return "Token";
  if (type === "api_key") return "API Key";
  return type;
}

function profileHealthLabel(status: string, t: TranslateFn) {
  const map: Record<string, string> = {
    ok: tt(t, "models.auth.ok", "OK"),
    expiring: tt(t, "models.auth.expiring", "Expiring soon"),
    expired: tt(t, "models.auth.expired", "Expired"),
    missing: tt(t, "models.auth.missing", "Missing"),
    static: tt(t, "models.auth.static", "Static"),
  };
  return map[status] ?? status;
}

function providerDisplayName(provider: string, authStatus: GatewayModelAuthStatusResult | null) {
  const auth = authStatus?.providers.find((item) => normalize(item.provider) === normalize(provider));
  return auth?.displayName || provider;
}

function providerAuthLabel(provider: string, authStatus: GatewayModelAuthStatusResult | null, t: TranslateFn) {
  const auth = authStatus?.providers.find((item) => normalize(item.provider) === normalize(provider));
  if (!auth) return tt(t, "models.auth.notConfigured", "Not configured");
  if (auth.status === "ok" || auth.status === "static") return auth.profiles.some((profile) => profile.type === "oauth") ? tt(t, "models.auth.oauthSignedIn", "OAuth signed in") : tt(t, "models.auth.configured", "Configured");
  if (auth.status === "expiring") return `${tt(t, "models.auth.expiring", "Expiring soon")}${auth.expiry?.label ? ` · ${auth.expiry.label}` : ""}`;
  if (auth.status === "expired") return tt(t, "models.auth.expiredAuth", "Authorization expired");
  if (auth.status === "missing") return tt(t, "models.auth.unauthorized", "Unauthorized");
  return auth.status;
}

function providerSupportsOAuth(provider: string, authStatus: GatewayModelAuthStatusResult | null) {
  if (oauthProviderLabels[provider]) return true;
  const auth = authStatus?.providers.find((item) => normalize(item.provider) === normalize(provider));
  return Boolean(auth?.profiles.some((profile) => profile.type === "oauth"));
}

function isProviderConfigured(provider: string, authStatus: GatewayModelAuthStatusResult | null) {
  const auth = authStatus?.providers.find((item) => normalize(item.provider) === normalize(provider));
  return Boolean(auth && (auth.status === "ok" || auth.status === "static"));
}

function modelTags(model: ModelRow, t: TranslateFn): string[] {
  const tags: string[] = [];
  const inputs = model.input ?? [];
  if (inputs.includes("text") || inputs.length === 0) tags.push(tt(t, "models.tag.text", "Text"));
  if (inputs.includes("image")) tags.push(tt(t, "models.tag.image", "Image"));
  if (inputs.includes("document")) tags.push(tt(t, "models.tag.document", "Document"));
  if (inputs.includes("audio")) tags.push(tt(t, "models.tag.audio", "Audio transcription"));
  if (inputs.includes("video")) tags.push(tt(t, "models.tag.video", "Video"));
  if (model.reasoning) tags.push(tt(t, "models.tag.reasoning", "Reasoning"));
  if (model.contextTokens || model.contextWindow) {
    const context = model.contextTokens ?? model.contextWindow ?? 0;
    if (context >= 100_000) tags.push(tt(t, "models.tag.longContext", "Long context"));
  }
  const catalogTags = model.tags?.filter((tag) => typeof tag === "string" && tag.trim()) ?? [];
  for (const tag of catalogTags) {
    const lower = tag.toLowerCase();
    if (
      lower.includes("transcription")
      || lower.includes("speech-to-text")
      || lower === "audio-transcription"
      || lower === "audio"
      || lower === "audio-input"
    ) {
      const audioTag = tt(t, "models.tag.audio", "Audio transcription");
      if (!tags.includes(audioTag)) tags.push(audioTag);
      continue;
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags.slice(0, 6);
}

export function ModelsPage({
  t,
  configuredModels,
  allModels,
  authStatus,
  loading,
  currentDefaultModel,
  actionBusy,
  message,
  onRefresh,
  onSetDefault,
  onAuthProvider,
  onSaveProviderConfig,
  onSaveModelConfig,
}: ModelsPageProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "configured" | "missing" | "oauth">("all");
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [providerDraft, setProviderDraft] = useState<ProviderConfigDraft | null>(null);
  const [modelDraft, setModelDraft] = useState<ModelConfigDraft | null>(null);

  const configuredRefs = useMemo(
    () => new Set(configuredModels.map((model) => normalize(qualifyModelRef(model))).filter(Boolean)),
    [configuredModels],
  );

  const providerGroups = useMemo(() => {
    const byRef = new Map<string, ModelRow>();
    for (const model of [...allModels, ...configuredModels]) {
      const { ref, provider, modelId } = splitModelRef(model);
      const key = normalize(ref);
      if (!key) continue;
      const existing = byRef.get(key);
      byRef.set(key, {
        ...existing,
        ...model,
        ref,
        provider,
        modelId,
        displayName: model.alias || model.label || model.name || modelId,
        configured: configuredRefs.has(key) || Boolean(existing?.configured),
      });
    }
    const defaultRef = currentDefaultModel?.trim();
    if (defaultRef && !byRef.has(normalize(defaultRef))) {
      const provider = defaultRef.includes("/") ? defaultRef.split("/")[0] : "default";
      const modelId = defaultRef.startsWith(`${provider}/`) ? defaultRef.slice(provider.length + 1) : defaultRef;
      byRef.set(normalize(defaultRef), {
        id: modelId,
        ref: defaultRef,
        provider,
        modelId,
        displayName: modelId,
        configured: true,
      });
    }

    const search = normalize(query);
    const rows = Array.from(byRef.values()).filter((model) => {
      if (filter === "configured" && !model.configured) return false;
      if (filter === "missing" && model.configured) return false;
      if (filter === "oauth" && !providerSupportsOAuth(model.provider, authStatus)) return false;
      if (!search) return true;
      return normalize(`${model.provider} ${model.modelId} ${model.displayName}`).includes(search);
    });

    const grouped = new Map<string, ModelRow[]>();
    for (const row of rows) {
      const list = grouped.get(row.provider) ?? [];
      list.push(row);
      grouped.set(row.provider, list);
    }

    return Array.from(grouped.entries())
      .map(([provider, models]) => ({
        provider,
        name: providerDisplayName(provider, authStatus),
        authLabel: providerAuthLabel(provider, authStatus, t),
        supportsOAuth: providerSupportsOAuth(provider, authStatus),
        configured: models.some((model) => model.configured) || isProviderConfigured(provider, authStatus),
        models: models.sort((left, right) => {
          const leftDefault = normalize(left.ref) === normalize(currentDefaultModel);
          const rightDefault = normalize(right.ref) === normalize(currentDefaultModel);
          if (leftDefault !== rightDefault) return leftDefault ? -1 : 1;
          if (left.configured !== right.configured) return left.configured ? -1 : 1;
          return left.displayName.localeCompare(right.displayName);
        }),
      }))
      .sort((left, right) => {
        const leftHasDefault = left.models.some((model) => normalize(model.ref) === normalize(currentDefaultModel));
        const rightHasDefault = right.models.some((model) => normalize(model.ref) === normalize(currentDefaultModel));
        if (leftHasDefault !== rightHasDefault) return leftHasDefault ? -1 : 1;
        return left.name.localeCompare(right.name);
      });
  }, [allModels, authStatus, configuredModels, configuredRefs, currentDefaultModel, filter, query, t]);

  useEffect(() => {
    if (providerGroups.length === 0) {
      setSelectedProvider(null);
      return;
    }
    if (!selectedProvider || !providerGroups.some((group) => group.provider === selectedProvider)) {
      setSelectedProvider(providerGroups[0]?.provider ?? null);
    }
  }, [providerGroups, selectedProvider]);

  const activeProviderGroup = providerGroups.find((group) => group.provider === selectedProvider) ?? providerGroups[0];

  const activeAuthProvider =
    activeProviderGroup && authStatus
      ? authStatus.providers.find((item) => normalize(item.provider) === normalize(activeProviderGroup.provider))
      : undefined;

  const configuredCount = configuredModels.length;
  const allCount = allModels.length;
  const authIssueCount = authStatus?.providers.filter((provider) => provider.status === "missing" || provider.status === "expired" || provider.status === "expiring").length ?? 0;

  return (
    <section className="single-page models-page">
      {loading ? <div className="inline-page-status">{tt(t, "models.loading", "Syncing model status...")}</div> : null}
      <div className="models-summary-grid">
        <div className="model-summary-stat"><span>{tt(t, "models.currentDefault", "Current default")}</span><strong>{currentDefaultModel || "-"}</strong></div>
        <div className="model-summary-stat"><span>{tt(t, "models.available", "Available models")}</span><strong>{configuredCount}</strong></div>
        <div className="model-summary-stat"><span>{tt(t, "models.total", "All models")}</span><strong>{allCount}</strong></div>
        <div className="model-summary-stat"><span>{tt(t, "models.authAlerts", "Auth alerts")}</span><strong>{authIssueCount}</strong></div>
      </div>

      <div className="models-toolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tt(t, "models.searchPlaceholder", "Search models, e.g. gpt, claude, gemini")} />
        <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
          <option value="all">{tt(t, "models.filter.all", "All")}</option>
          <option value="configured">{tt(t, "models.filter.configured", "Configured")}</option>
          <option value="missing">{tt(t, "models.filter.missing", "Missing")}</option>
          <option value="oauth">OAuth</option>
        </select>
        <button className="ghost-link-button primary-action" type="button" onClick={onRefresh} disabled={loading || actionBusy}>{tt(t, "common.refresh", "Refresh")}</button>
      </div>

      {message ? <div className="model-action-message">{message}</div> : null}
      {actionBusy ? <div className="inline-page-status">{tt(t, "models.busy", "Processing model action...")}</div> : null}

      <div className="models-split-layout">
        <aside className="model-provider-sidebar">
          <button
            className="model-provider-add-button"
            type="button"
            onClick={() => setProviderDraft({ provider: "", apiKey: "", baseUrl: "" })}
          >
            {tt(t, "models.addProvider", "Add provider")}
          </button>
          {providerGroups.map((group) => {
            const providerDefault = group.models.find((model) => normalize(model.ref) === normalize(currentDefaultModel));
            const availableCount = group.models.filter((model) => model.configured).length;
            return (
              <button
                className={`model-provider-tab ${group.provider === activeProviderGroup?.provider ? "active" : ""}`}
                type="button"
                key={group.provider}
                onClick={() => setSelectedProvider(group.provider)}
              >
                <strong>{group.name}</strong>
                <span>{providerDefault ? `${tt(t, "models.default", "Default")}: ${providerDefault.displayName}` : group.authLabel}</span>
                <em>{availableCount}/{group.models.length}</em>
              </button>
            );
          })}
        </aside>

        <section className="model-provider-detail">
          {activeProviderGroup ? (
            <>
              <div className="model-provider-head">
                <div>
                  <strong>{activeProviderGroup.name}</strong>
                  <span>{activeProviderGroup.models.length} {tt(t, "models.countUnit", "models")} · {activeProviderGroup.authLabel}</span>
                </div>
                <div className="model-provider-actions">
                  {activeProviderGroup.supportsOAuth ? (
                    <button className="ghost-link-button" type="button" onClick={() => onAuthProvider(activeProviderGroup.provider, false)} disabled={actionBusy}>
                      {tt(t, "models.oauthLogin", "OAuth sign in")}
                    </button>
                  ) : null}
                  <button
                    className="ghost-link-button"
                    type="button"
                    onClick={() => setProviderDraft({ provider: activeProviderGroup.provider, apiKey: "", baseUrl: "" })}
                  >
                    {tt(t, "common.configure", "Configure")}
                  </button>
                  {activeProviderGroup.configured ? (
                    <button
                      className="ghost-link-button primary-action"
                      type="button"
                      onClick={() => setModelDraft({ provider: activeProviderGroup.provider, modelId: "", alias: "", setDefault: false })}
                      disabled={actionBusy}
                    >
                      {tt(t, "common.add", "Add")}
                    </button>
                  ) : null}
                </div>
              </div>

              {authStatus && activeAuthProvider ? (
                <div className="model-auth-profiles" aria-label={tt(t, "models.authProfilesAria", "Gateway auth profiles")}>
                  <div className="model-auth-profiles-caption">
                    <span className="model-auth-profiles-title">{tt(t, "models.authProfiles", "Auth profiles")}</span>
                    <span className="model-auth-profiles-source">{tt(t, "models.authProfilesSource", "From Gateway · models.authStatus")}</span>
                  </div>
                  {activeAuthProvider.profiles.length > 0 ? (
                    <ul className="model-auth-profile-list">
                      {activeAuthProvider.profiles.map((profile, index) => (
                        <li key={`${profile.profileId}-${profile.type}-${index}`}>
                          <code className="auth-profile-id" title={profile.profileId}>
                            {profile.profileId}
                          </code>
                          <span className="auth-profile-type">{profileCredentialLabel(profile.type)}</span>
                          <span className={`auth-profile-status auth-status-${profile.status}`}>{profileHealthLabel(profile.status, t)}</span>
                          {profile.expiry?.label ? <span className="auth-profile-expiry">{profile.expiry.label}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="model-auth-profiles-empty">
                      {tt(t, "models.authProfilesEmpty", "Gateway did not return independent profile rows. API-key/env setups may not appear here.")}
                    </p>
                  )}
                  {activeAuthProvider.usage?.plan ? (
                    <p className="model-auth-usage-hint">{tt(t, "models.usagePlan", "Usage plan")}: {String(activeAuthProvider.usage.plan)}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="model-row-list">
                {activeProviderGroup.models.map((model) => {
                  const isDefault = normalize(model.ref) === normalize(currentDefaultModel);
                  const providerConfigured = activeProviderGroup.configured;
                  return (
                    <div className={`model-row ${model.configured ? "configured" : "missing"} ${isDefault ? "default" : ""} ${providerConfigured ? "" : "disabled"}`} key={model.ref}>
                      <div className="model-row-main">
                        <strong>{model.displayName}</strong>
                        <code>{model.ref}</code>
                        <div className="model-row-tags">
                          {modelTags(model, t).map((tag) => (
                            <span
                              key={tag}
                              title={tag === tt(t, "models.tag.audio", "Audio transcription") ? tt(t, "models.audioTooltip", "Gateway metadata: supports audio input/transcription.") : undefined}
                            >
                              {tag}
                            </span>
                          ))}
                          {isDefault ? <span className="model-default-tag">{tt(t, "models.defaultModel", "Default model")}</span> : null}
                          {providerConfigured ? (model.configured ? <span>{tt(t, "models.added", "Added")}</span> : <span>{tt(t, "models.addable", "Addable")}</span>) : <span>{tt(t, "models.providerNotConfigured", "Provider not configured")}</span>}
                        </div>
                      </div>
                      <div className="model-row-actions">
                        {providerConfigured ? (
                          <>
                            <button
                              className="ghost-link-button"
                              type="button"
                              onClick={() => setModelDraft({ provider: model.provider, modelId: model.modelId, alias: model.displayName === model.modelId ? "" : model.displayName, setDefault: false })}
                              disabled={actionBusy}
                            >
                              {tt(t, "common.edit", "Edit")}
                            </button>
                            {isDefault ? (
                              <span className="current-model-pill">{tt(t, "models.currentDefault", "Current default")}</span>
                            ) : (
                              <button className="ghost-link-button primary-action" type="button" onClick={() => onSetDefault(model.ref)} disabled={actionBusy}>
                                {tt(t, "models.setDefault", "Set as default")}
                              </button>
                            )}
                          </>
                        ) : (
                          <span className="current-model-pill muted">{tt(t, "models.configureProviderFirst", "Configure provider first")}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : !loading ? (
            <div className="empty-panel">{tt(t, "models.empty", "No models to display.")}</div>
          ) : null}
        </section>
        {!providerGroups.length && !loading ? <div className="empty-panel">{tt(t, "models.empty", "No models to display.")}</div> : null}
      </div>

      {providerDraft ? (
        <div className="model-config-backdrop" role="dialog" aria-modal="true">
          <form
            className="model-config-drawer"
            onSubmit={(event) => {
              event.preventDefault();
              onSaveProviderConfig(providerDraft);
            }}
          >
            <div className="model-config-head">
              <div>
                <strong>{tt(t, "models.configureProvider", "Configure provider")}</strong>
                <span>{providerDisplayName(providerDraft.provider, authStatus)}</span>
              </div>
              <button type="button" onClick={() => setProviderDraft(null)} title={tt(t, "common.close", "Close")} aria-label={tt(t, "common.close", "Close")}>×</button>
            </div>
            <label>
              <span>Provider</span>
              <input value={providerDraft.provider} onChange={(event) => setProviderDraft({ ...providerDraft, provider: event.target.value.trim() })} required />
            </label>
            <label>
              <span>API Key</span>
              <input value={providerDraft.apiKey} onChange={(event) => setProviderDraft({ ...providerDraft, apiKey: event.target.value })} type="password" placeholder={tt(t, "models.apiKeyPlaceholder", "Leave empty if OAuth or env var is already configured")} />
            </label>
            <label>
              <span>Base URL</span>
              <input value={providerDraft.baseUrl} onChange={(event) => setProviderDraft({ ...providerDraft, baseUrl: event.target.value })} placeholder={tt(t, "models.baseUrlPlaceholder", "Optional, common for OpenAI-compatible services")} />
            </label>
            <button className="openclaw-update-button" type="submit" disabled={actionBusy}>
              {actionBusy ? tt(t, "common.saving", "Saving...") : tt(t, "models.saveProvider", "Save provider")}
            </button>
          </form>
        </div>
      ) : null}

      {modelDraft ? (
        <div className="model-config-backdrop" role="dialog" aria-modal="true">
          <form
            className="model-config-drawer"
            onSubmit={(event) => {
              event.preventDefault();
              onSaveModelConfig(modelDraft);
            }}
          >
            <div className="model-config-head">
              <div>
                <strong>{tt(t, "models.editModel", "Edit model")}</strong>
                <span>{providerDisplayName(modelDraft.provider, authStatus)}</span>
              </div>
              <button type="button" onClick={() => setModelDraft(null)} title={tt(t, "common.close", "Close")} aria-label={tt(t, "common.close", "Close")}>×</button>
            </div>
            <label>
              <span>Provider</span>
              <input value={modelDraft.provider} readOnly />
            </label>
            <label>
              <span>{tt(t, "models.modelName", "Model name")}</span>
              <input value={modelDraft.modelId} onChange={(event) => setModelDraft({ ...modelDraft, modelId: event.target.value })} placeholder={tt(t, "models.modelNamePlaceholder", "e.g. gpt-5.5")} required />
            </label>
            <label>
              <span>{tt(t, "models.displayName", "Display name")}</span>
              <input value={modelDraft.alias} onChange={(event) => setModelDraft({ ...modelDraft, alias: event.target.value })} placeholder={tt(t, "models.displayNamePlaceholder", "Optional, e.g. primary model")} />
            </label>
            <label className="model-checkbox-row">
              <input type="checkbox" checked={modelDraft.setDefault} onChange={(event) => setModelDraft({ ...modelDraft, setDefault: event.target.checked })} />
              <span>{tt(t, "models.setDefaultAfterSave", "Set as default after saving")}</span>
            </label>
            <button className="openclaw-update-button" type="submit" disabled={actionBusy}>
              {actionBusy ? tt(t, "common.saving", "Saving...") : tt(t, "models.saveModel", "Save model")}
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
