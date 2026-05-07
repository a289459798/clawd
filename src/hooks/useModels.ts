import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ModelOption } from "../types/app";
import type { GatewayModelsResult } from "../types/gateway";
import { buildModelOptions } from "../lib/modelOptions";

interface UseModelsProps {
  enabled: boolean;
  defaultModel?: string | null;
}

interface UseModelsReturn {
  modelOptions: ModelOption[];
  modelsLoading: boolean;
  setModelOptions: (options: ModelOption[]) => void;
  reloadModels: () => Promise<void>;
}

export function useModels({ enabled, defaultModel }: UseModelsProps): UseModelsReturn {
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  const reloadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      await invoke("gateway_connect");
      const result = await invoke<GatewayModelsResult>("gateway_models_list", { params: { view: "configured" } });
      setModelOptions(buildModelOptions(result, defaultModel));
    } catch (error) {
      console.error("Failed to load OpenClaw models", error);
      setModelOptions([]);
    } finally {
      setModelsLoading(false);
    }
  }, [defaultModel]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const loadModels = async () => {
      setModelsLoading(true);
      try {
        await invoke("gateway_connect");
        const result = await invoke<GatewayModelsResult>("gateway_models_list", { params: { view: "configured" } });
        if (!cancelled) {
          setModelOptions(buildModelOptions(result, defaultModel));
        }
      } catch (error) {
        console.error("Failed to load OpenClaw models", error);
        if (!cancelled) {
          setModelOptions([]);
        }
      } finally {
        if (!cancelled) {
          setModelsLoading(false);
        }
      }
    };

    void loadModels();

    return () => {
      cancelled = true;
    };
  }, [enabled, defaultModel]);

  return {
    modelOptions,
    modelsLoading,
    setModelOptions,
    reloadModels,
  };
}
