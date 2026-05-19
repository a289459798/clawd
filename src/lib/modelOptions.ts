import type { GatewayModelsResult } from "../types/gateway";
import type { ModelOption } from "../types/app";

export const normalizeModelKey = (value: string) => value.trim().toLowerCase();

const DEPRECATED_GEMINI_3_PRO_PREVIEW_KEYS = new Set([
  "google/gemini-3-pro-preview",
  "gemini-3-pro-preview",
]);

export const GEMINI_31_PRO_PREVIEW_MODEL = "google/gemini-3.1-pro-preview";

export const isDeprecatedGemini3ProPreview = (value: string) =>
  DEPRECATED_GEMINI_3_PRO_PREVIEW_KEYS.has(normalizeModelKey(value));

export const findGemini31ProPreviewOption = (options: ModelOption[]) =>
  options.find((option) => normalizeModelKey(option.value) === normalizeModelKey(GEMINI_31_PRO_PREVIEW_MODEL));

export const isUnconfiguredModelRef = (value: string) => {
  const normalized = normalizeModelKey(value);
  return !normalized || normalized === "未配置" || normalized === "not configured";
};

export const qualifyModelId = (id: string, provider?: string) => {
  const trimmedId = id.trim();
  const trimmedProvider = provider?.trim();
  if (!trimmedId) return "";
  if (!trimmedProvider || trimmedId.includes("/")) return trimmedId;
  return `${trimmedProvider}/${trimmedId}`;
};

const matchesDefaultModel = (value: string, defaultModel?: string | null) => {
  const normalizedDefault = normalizeModelKey(defaultModel ?? "");
  if (!normalizedDefault) return false;
  return normalizeModelKey(value) === normalizedDefault;
};

export const buildModelOptions = (result?: GatewayModelsResult | null, defaultModel?: string | null): ModelOption[] => {
  const models = Array.isArray(result?.models) ? result.models : [];
  const seen = new Set<string>();
  const options = models
    .map((model) => {
      const value = model.ref?.trim() || model.key?.trim() || qualifyModelId(model.id, model.provider);
      if (!value) return null;
      const displayName = model.alias?.trim() || model.label?.trim() || model.name?.trim() || model.id.trim();
      const provider = model.provider?.trim();
      const baseLabel = provider && !displayName.toLowerCase().includes(provider.toLowerCase())
        ? `${displayName} · ${provider}`
        : displayName;
      const isDefault =
        matchesDefaultModel(value, defaultModel) ||
        (model.tags ?? []).some((tag) => tag.toLowerCase() === "default");
      const label = isDefault ? `${baseLabel} · 默认` : baseLabel;
      return { value, label, isDefault };
    })
    .filter((option): option is ModelOption & { isDefault: boolean } => {
      if (!option) return false;
      const key = normalizeModelKey(option.value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => Number(right.isDefault) - Number(left.isDefault))
    .map(({ isDefault: _isDefault, ...option }) => option);
  const defaultValue = defaultModel?.trim();
  if (!defaultValue || options.some((option) => normalizeModelKey(option.value) === normalizeModelKey(defaultValue))) {
    return options;
  }
  return [{ value: defaultValue, label: `${defaultValue} · 默认` }, ...options];
};

export const ensureSelectedModelOption = (options: ModelOption[], selectedModel: string): ModelOption[] => {
  const selected = selectedModel.trim();
  if (!selected) return options;
  if (options.some((option) => normalizeModelKey(option.value) === normalizeModelKey(selected))) {
    return options;
  }
  const currentOption = { value: selected, label: `当前: ${selected}` };
  const defaultIndex = options.findIndex((option) => option.label.includes("默认"));
  if (defaultIndex < 0) return [currentOption, ...options];
  return [
    ...options.slice(0, defaultIndex + 1),
    currentOption,
    ...options.slice(defaultIndex + 1),
  ];
};

export const canonicalizeModelRef = (value: string, options: ModelOption[], provider?: string) => {
  const selected = value.trim();
  if (isUnconfiguredModelRef(selected)) return selected;
  const selectedKey = normalizeModelKey(selected);
  const exact = options.find((option) => normalizeModelKey(option.value) === selectedKey);
  if (exact) return exact.value;
  if (selected.includes("/")) return selected;

  const providerPrefix = provider?.trim();
  if (providerPrefix) {
    const byProvider = options.find((option) => normalizeModelKey(option.value) === normalizeModelKey(`${providerPrefix}/${selected}`));
    if (byProvider) return byProvider.value;
  }

  const suffixMatches = options.filter((option) => normalizeModelKey(option.value).endsWith(`/${selectedKey}`));
  if (suffixMatches.length > 0) return suffixMatches[0].value;
  return selected;
};
