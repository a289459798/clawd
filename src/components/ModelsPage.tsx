import { useEffect, useMemo, useState } from "react";
import type { GatewayModelAuthStatusResult, GatewayModelSummary } from "../types/gateway";

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

function providerDisplayName(provider: string, authStatus: GatewayModelAuthStatusResult | null) {
  const auth = authStatus?.providers.find((item) => normalize(item.provider) === normalize(provider));
  return auth?.displayName || provider;
}

function providerAuthLabel(provider: string, authStatus: GatewayModelAuthStatusResult | null) {
  const auth = authStatus?.providers.find((item) => normalize(item.provider) === normalize(provider));
  if (!auth) return "未配置";
  if (auth.status === "ok" || auth.status === "static") return auth.profiles.some((profile) => profile.type === "oauth") ? "OAuth 已登录" : "已配置";
  if (auth.status === "expiring") return `即将过期${auth.expiry?.label ? ` · ${auth.expiry.label}` : ""}`;
  if (auth.status === "expired") return "授权已过期";
  if (auth.status === "missing") return "未授权";
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

function modelTags(model: ModelRow) {
  const tags = new Set<string>();
  if (model.input?.includes("text") || !model.input?.length) tags.add("文本");
  if (model.input?.includes("image")) tags.add("图片");
  if (model.input?.includes("document")) tags.add("文档");
  if (model.reasoning) tags.add("推理");
  if (model.contextTokens || model.contextWindow) {
    const context = model.contextTokens ?? model.contextWindow ?? 0;
    if (context >= 100_000) tags.add("长上下文");
  }
  return Array.from(tags).slice(0, 4);
}

export function ModelsPage({
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
        authLabel: providerAuthLabel(provider, authStatus),
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
  }, [allModels, authStatus, configuredModels, configuredRefs, currentDefaultModel, filter, query]);

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

  const configuredCount = configuredModels.length;
  const allCount = allModels.length;
  const authIssueCount = authStatus?.providers.filter((provider) => provider.status === "missing" || provider.status === "expired" || provider.status === "expiring").length ?? 0;

  return (
    <section className="single-page models-page">
      {loading ? <div className="inline-page-status">正在同步模型状态...</div> : null}
      <div className="models-summary-grid">
        <div className="model-summary-stat"><span>当前默认</span><strong>{currentDefaultModel || "-"}</strong></div>
        <div className="model-summary-stat"><span>可用模型</span><strong>{configuredCount}</strong></div>
        <div className="model-summary-stat"><span>全部模型</span><strong>{allCount}</strong></div>
        <div className="model-summary-stat"><span>授权提醒</span><strong>{authIssueCount}</strong></div>
      </div>

      <div className="models-toolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型，例如 gpt、claude、gemini" />
        <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
          <option value="all">全部</option>
          <option value="configured">可用</option>
          <option value="missing">未配置</option>
          <option value="oauth">OAuth</option>
        </select>
        <button className="ghost-link-button primary-action" type="button" onClick={onRefresh} disabled={loading || actionBusy}>刷新</button>
      </div>

      {message ? <div className="model-action-message">{message}</div> : null}
      {actionBusy ? <div className="inline-page-status">正在处理模型操作...</div> : null}

      <div className="models-split-layout">
        <aside className="model-provider-sidebar">
          <button
            className="model-provider-add-button"
            type="button"
            onClick={() => setProviderDraft({ provider: "", apiKey: "", baseUrl: "" })}
          >
            添加 Provider
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
                <span>{providerDefault ? `默认：${providerDefault.displayName}` : group.authLabel}</span>
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
                  <span>{activeProviderGroup.models.length} 个模型 · {activeProviderGroup.authLabel}</span>
                </div>
                <div className="model-provider-actions">
                  {activeProviderGroup.supportsOAuth ? (
                    <button className="ghost-link-button" type="button" onClick={() => onAuthProvider(activeProviderGroup.provider, false)} disabled={actionBusy}>
                      授权登录
                    </button>
                  ) : null}
                  <button
                    className="ghost-link-button"
                    type="button"
                    onClick={() => setProviderDraft({ provider: activeProviderGroup.provider, apiKey: "", baseUrl: "" })}
                  >
                    配置
                  </button>
                  {activeProviderGroup.configured ? (
                    <button
                      className="ghost-link-button primary-action"
                      type="button"
                      onClick={() => setModelDraft({ provider: activeProviderGroup.provider, modelId: "", alias: "", setDefault: false })}
                      disabled={actionBusy}
                    >
                      增加
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="model-row-list">
                {activeProviderGroup.models.map((model) => {
                  const isDefault = normalize(model.ref) === normalize(currentDefaultModel);
                  const providerConfigured = activeProviderGroup.configured;
                  return (
                    <div className={`model-row ${model.configured ? "configured" : "missing"} ${providerConfigured ? "" : "disabled"}`} key={model.ref}>
                      <div className="model-row-main">
                        <strong>{model.displayName}</strong>
                        <code>{model.ref}</code>
                        <div className="model-row-tags">
                          {modelTags(model).map((tag) => <span key={tag}>{tag}</span>)}
                          {providerConfigured ? (model.configured ? <span>已添加</span> : <span>可添加</span>) : <span>Provider 未配置</span>}
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
                              修改
                            </button>
                            {isDefault ? (
                              <span className="current-model-pill">当前默认</span>
                            ) : (
                              <button className="ghost-link-button primary-action" type="button" onClick={() => onSetDefault(model.ref)} disabled={actionBusy}>
                                设为默认
                              </button>
                            )}
                          </>
                        ) : (
                          <span className="current-model-pill muted">请先配置 Provider</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : !loading ? (
            <div className="empty-panel">暂无可展示模型。</div>
          ) : null}
        </section>
        {!providerGroups.length && !loading ? <div className="empty-panel">暂无可展示模型。</div> : null}
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
                <strong>配置 Provider</strong>
                <span>{providerDisplayName(providerDraft.provider, authStatus)}</span>
              </div>
              <button type="button" onClick={() => setProviderDraft(null)} title="关闭" aria-label="关闭">×</button>
            </div>
            <label>
              <span>Provider</span>
              <input value={providerDraft.provider} onChange={(event) => setProviderDraft({ ...providerDraft, provider: event.target.value.trim() })} required />
            </label>
            <label>
              <span>API Key</span>
              <input value={providerDraft.apiKey} onChange={(event) => setProviderDraft({ ...providerDraft, apiKey: event.target.value })} type="password" placeholder="已通过 OAuth 或环境变量配置时可留空" />
            </label>
            <label>
              <span>Base URL</span>
              <input value={providerDraft.baseUrl} onChange={(event) => setProviderDraft({ ...providerDraft, baseUrl: event.target.value })} placeholder="可选，OpenAI-compatible 服务常用" />
            </label>
            <button className="openclaw-update-button" type="submit" disabled={actionBusy}>
              {actionBusy ? "保存中..." : "保存 Provider"}
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
                <strong>修改模型</strong>
                <span>{providerDisplayName(modelDraft.provider, authStatus)}</span>
              </div>
              <button type="button" onClick={() => setModelDraft(null)} title="关闭" aria-label="关闭">×</button>
            </div>
            <label>
              <span>Provider</span>
              <input value={modelDraft.provider} readOnly />
            </label>
            <label>
              <span>模型名称</span>
              <input value={modelDraft.modelId} onChange={(event) => setModelDraft({ ...modelDraft, modelId: event.target.value })} placeholder="例如 gpt-5.5" required />
            </label>
            <label>
              <span>显示名称</span>
              <input value={modelDraft.alias} onChange={(event) => setModelDraft({ ...modelDraft, alias: event.target.value })} placeholder="可选，例如 主力模型" />
            </label>
            <label className="model-checkbox-row">
              <input type="checkbox" checked={modelDraft.setDefault} onChange={(event) => setModelDraft({ ...modelDraft, setDefault: event.target.checked })} />
              <span>保存后设为默认模型</span>
            </label>
            <button className="openclaw-update-button" type="submit" disabled={actionBusy}>
              {actionBusy ? "保存中..." : "保存模型"}
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
