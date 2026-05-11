import { invoke } from "@tauri-apps/api/core";
import { startTransition, useCallback, useState } from "react";
import { buildModelOptions } from "../lib/modelOptions";
import type { GatewayModelAuthStatusResult, GatewayModelSummary, GatewayModelsResult } from "../types/gateway";

export function useModelsPageData({
  currentDefaultModel,
  setModelOptions,
  refreshFailedMessage,
}: {
  currentDefaultModel: string | null;
  setModelOptions: (updater: Array<{ value: string; label: string }>) => void;
  refreshFailedMessage: string;
}) {
  const [modelsPageLoading, setModelsPageLoading] = useState(false);
  const [modelActionBusy, setModelActionBusy] = useState(false);
  const [modelsActionMessage, setModelsActionMessage] = useState<string | null>(null);
  const [configuredModels, setConfiguredModels] = useState<GatewayModelSummary[]>([]);
  const [allModels, setAllModels] = useState<GatewayModelSummary[]>([]);
  const [modelAuthStatus, setModelAuthStatus] = useState<GatewayModelAuthStatusResult | null>(null);
  const [modelsPageReady, setModelsPageReady] = useState(false);

  const refreshModelsPage = useCallback(async (options?: { refreshAuth?: boolean }) => {
    setModelsPageLoading(true);
    try {
      await invoke("gateway_connect");
      const [configuredResult, authResult] = await Promise.all([
        invoke<GatewayModelsResult>("gateway_models_list", { params: { view: "configured" } }),
        invoke<GatewayModelAuthStatusResult>("gateway_models_auth_status", { params: { refresh: Boolean(options?.refreshAuth) } }),
      ]);
      startTransition(() => {
        setConfiguredModels(configuredResult.models ?? []);
        setModelAuthStatus(authResult);
        setModelOptions(buildModelOptions(configuredResult, currentDefaultModel));
      });
      setModelsPageLoading(false);
      void (async () => {
        try {
          const allResult = await invoke<GatewayModelsResult>("gateway_models_list", { params: { view: "all" } });
          startTransition(() => setAllModels(allResult.models ?? []));
        } catch (error) {
          console.warn("Failed to refresh full model catalog", error);
        }
      })();
    } catch (error) {
      console.warn("Failed to refresh models page", error);
      setModelsActionMessage(error instanceof Error ? error.message : refreshFailedMessage);
      setModelsPageLoading(false);
    }
  }, [currentDefaultModel, refreshFailedMessage, setModelOptions]);

  return {
    modelsPageLoading,
    modelActionBusy,
    modelsActionMessage,
    configuredModels,
    allModels,
    modelAuthStatus,
    modelsPageReady,
    setModelActionBusy,
    setModelsActionMessage,
    setModelsPageLoading,
    setModelsPageReady,
    refreshModelsPage,
  };
}
