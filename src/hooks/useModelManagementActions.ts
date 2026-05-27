import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";
import type { GatewayOpenClawStatusResult } from "../types/gateway";

type TranslateFn = (key: string) => string;

export function useModelManagementActions({
  t,
  patchOpenClawConfig,
  refreshModelsPage,
  refreshOpenClawStatus,
  setModelActionBusy,
  setModelsActionMessage,
  setComposerModel,
  setOpenClawConfigDefaultModel,
  setOpenClawConfigDefaultModelLoaded,
  setOpenClawStatus,
}: {
  t: TranslateFn;
  patchOpenClawConfig: (patch: unknown) => Promise<void>;
  refreshModelsPage: (options?: { refreshAuth?: boolean }) => Promise<void>;
  refreshOpenClawStatus: () => Promise<void>;
  setModelActionBusy: (busy: boolean) => void;
  setModelsActionMessage: (message: string | null) => void;
  setComposerModel: (model: string) => void;
  setOpenClawConfigDefaultModel: (model: string) => void;
  setOpenClawConfigDefaultModelLoaded: (loaded: boolean) => void;
  setOpenClawStatus: (
    updater: (current: GatewayOpenClawStatusResult | null) => GatewayOpenClawStatusResult | null,
  ) => void;
}) {
  const handleSetDefaultModel = useCallback(async (modelRef: string) => {
    setModelActionBusy(true);
    setModelsActionMessage(null);
    try {
      await patchOpenClawConfig({ agents: { defaults: { model: { primary: modelRef }, models: { [modelRef]: {} } } } });
      setModelsActionMessage(`${t("app.setDefaultModelSuccess")}: ${modelRef}`);
      setComposerModel(modelRef);
      setOpenClawConfigDefaultModel(modelRef);
      setOpenClawConfigDefaultModelLoaded(true);
      setOpenClawStatus((current) => current ? {
        ...current,
        sessions: {
          ...current.sessions,
          defaults: {
            ...current.sessions?.defaults,
            model: modelRef,
          },
        },
      } : current);
      void refreshOpenClawStatus();
      void refreshModelsPage({ refreshAuth: true });
    } catch (error) {
      console.error("Failed to set default model", error);
      setModelsActionMessage(error instanceof Error ? error.message : t("app.setDefaultModelFailed"));
    } finally {
      setModelActionBusy(false);
    }
  }, [
    patchOpenClawConfig,
    refreshModelsPage,
    refreshOpenClawStatus,
    setComposerModel,
    setModelActionBusy,
    setModelsActionMessage,
    setOpenClawConfigDefaultModel,
    setOpenClawConfigDefaultModelLoaded,
    setOpenClawStatus,
    t,
  ]);

  const handleModelAuthProvider = useCallback(async (provider: string, setDefault: boolean) => {
    setModelActionBusy(true);
    setModelsActionMessage(null);
    try {
      const message = await invoke<string>("open_model_auth_terminal", { provider, setDefault });
      setModelsActionMessage(message);
      window.setTimeout(() => void refreshModelsPage({ refreshAuth: true }), 1500);
    } catch (error) {
      console.error("Failed to open model auth terminal", error);
      setModelsActionMessage(error instanceof Error ? error.message : t("app.openModelAuthFailed"));
    } finally {
      setModelActionBusy(false);
    }
  }, [refreshModelsPage, setModelActionBusy, setModelsActionMessage, t]);

  const handleSaveProviderConfig = useCallback(async (draft: { provider: string; apiKey: string; baseUrl: string }) => {
    const provider = draft.provider.trim();
    if (!provider) {
      setModelsActionMessage(t("app.providerRequired"));
      return;
    }
    const providerConfig: Record<string, unknown> = {};
    if (draft.apiKey.trim()) providerConfig.apiKey = draft.apiKey.trim();
    if (draft.baseUrl.trim()) providerConfig.baseUrl = draft.baseUrl.trim();
    if (Object.keys(providerConfig).length === 0) {
      setModelsActionMessage(t("app.apiKeyOrBaseUrlRequired"));
      return;
    }
    setModelActionBusy(true);
    setModelsActionMessage(null);
    try {
      await patchOpenClawConfig({ models: { providers: { [provider]: providerConfig } } });
      setModelsActionMessage(`${t("app.providerSaved")}: ${provider}`);
      void refreshModelsPage({ refreshAuth: true });
    } catch (error) {
      console.error("Failed to save provider config", error);
      setModelsActionMessage(error instanceof Error ? error.message : t("app.saveProviderConfigFailed"));
    } finally {
      setModelActionBusy(false);
    }
  }, [patchOpenClawConfig, refreshModelsPage, setModelActionBusy, setModelsActionMessage, t]);

  const handleSaveModelConfig = useCallback(async (draft: { provider: string; modelId: string; alias: string; setDefault: boolean }) => {
    const provider = draft.provider.trim();
    const modelId = draft.modelId.trim();
    if (!provider || !modelId) {
      setModelsActionMessage(t("app.providerAndModelRequired"));
      return;
    }
    const modelRef = `${provider}/${modelId}`;
    const patch: Record<string, unknown> = {
      models: { providers: { [provider]: { models: [{ id: modelId, ...(draft.alias.trim() ? { name: draft.alias.trim() } : {}) }] } } },
      agents: {
        defaults: {
          models: { [modelRef]: draft.alias.trim() ? { alias: draft.alias.trim() } : {} },
          ...(draft.setDefault ? { model: { primary: modelRef } } : {}),
        },
      },
    };

    setModelActionBusy(true);
    setModelsActionMessage(null);
    try {
      await patchOpenClawConfig(patch);
      if (draft.setDefault) {
        setComposerModel(modelRef);
        setOpenClawConfigDefaultModel(modelRef);
        setOpenClawConfigDefaultModelLoaded(true);
        setOpenClawStatus((current) => current ? {
          ...current,
          sessions: {
            ...current.sessions,
            defaults: {
              ...current.sessions?.defaults,
              model: modelRef,
            },
          },
        } : current);
      }
      setModelsActionMessage(draft.setDefault ? `${t("app.modelSavedAndDefault")}: ${modelRef}` : `${t("app.modelSaved")}: ${modelRef}`);
      void refreshOpenClawStatus();
      void refreshModelsPage({ refreshAuth: true });
    } catch (error) {
      console.error("Failed to save provider model config", error);
      setModelsActionMessage(error instanceof Error ? error.message : t("app.saveModelConfigFailed"));
    } finally {
      setModelActionBusy(false);
    }
  }, [
    patchOpenClawConfig,
    refreshModelsPage,
    refreshOpenClawStatus,
    setComposerModel,
    setModelActionBusy,
    setModelsActionMessage,
    setOpenClawConfigDefaultModel,
    setOpenClawConfigDefaultModelLoaded,
    setOpenClawStatus,
    t,
  ]);

  return {
    handleSetDefaultModel,
    handleModelAuthProvider,
    handleSaveProviderConfig,
    handleSaveModelConfig,
  };
}
