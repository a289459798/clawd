import type { GatewayModelsResult } from "../types/gateway";
import type { ModelOption } from "../types/app";

export const normalizeModelKey = (value: string) => value.trim().toLowerCase();

export const qualifyModelId = (id: string, provider?: string) => {
  const trimmedId = id.trim();
  const trimmedProvider = provider?.trim();
  if (!trimmedId) return "";
  if (!trimmedProvider || trimmedId.includes("/")) return trimmedId;
  return `${trimmedProvider}/${trimmedId}`;
};

export const buildModelOptions = (result?: GatewayModelsResult | null): ModelOption[] => {
  const models = Array.isArray(result?.models) ? result.models : [];
  const seen = new Set<string>();
  return models
    .map((model) => {
      const value = model.ref?.trim() || qualifyModelId(model.id, model.provider);
      if (!value) return null;
      const displayName = model.alias?.trim() || model.label?.trim() || model.name?.trim() || model.id.trim();
      const provider = model.provider?.trim();
      const label = provider && !displayName.toLowerCase().includes(provider.toLowerCase())
        ? `${displayName} · ${provider}`
        : displayName;
      return { value, label };
    })
    .filter((option): option is ModelOption => {
      if (!option) return false;
      const key = normalizeModelKey(option.value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export const ensureSelectedModelOption = (options: ModelOption[], selectedModel: string): ModelOption[] => {
  const selected = selectedModel.trim();
  if (!selected) return options;
  if (options.some((option) => normalizeModelKey(option.value) === normalizeModelKey(selected))) {
    return options;
  }
  return [{ value: selected, label: `当前: ${selected}` }, ...options];
};
