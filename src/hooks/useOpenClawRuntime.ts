import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import { resolveConfigDefaultModel } from "../lib/appDerivedData";
import type { OpenClawCliStatus } from "../types/app";
import type {
  GatewayConfigGetResult,
  GatewayOpenClawStatusResult,
  GatewayUpdateStatusResult,
} from "../types/gateway";

export function useOpenClawRuntime({
  refreshGatewayStatus,
}: {
  refreshGatewayStatus: () => Promise<void>;
}) {
  const [openClawStatus, setOpenClawStatus] = useState<GatewayOpenClawStatusResult | null>(null);
  const [openClawConfigDefaultModel, setOpenClawConfigDefaultModel] = useState<string | null>(null);
  const [openClawConfigDefaultModelLoaded, setOpenClawConfigDefaultModelLoaded] = useState(false);
  const [openClawCliStatus, setOpenClawCliStatus] = useState<OpenClawCliStatus | null>(null);
  const [gatewayUpdateRestartSentinel, setGatewayUpdateRestartSentinel] = useState<unknown>(null);

  const refreshOpenClawDefaultModel = useCallback(async () => {
    try {
      await invoke("gateway_connect");
      const configResult = await invoke<GatewayConfigGetResult>("gateway_config_get");
      setOpenClawConfigDefaultModel(resolveConfigDefaultModel(configResult.config));
    } catch (error) {
      console.warn("Failed to load OpenClaw default model", error);
    } finally {
      setOpenClawConfigDefaultModelLoaded(true);
    }
  }, []);

  const refreshOpenClawStatus = useCallback(async () => {
    try {
      await invoke("gateway_connect");
      const [status, updateStatus, configResult] = await Promise.all([
        invoke<GatewayOpenClawStatusResult>("gateway_openclaw_status"),
        invoke<GatewayUpdateStatusResult>("gateway_update_status").catch(() => null),
        invoke<GatewayConfigGetResult>("gateway_config_get").catch(() => null),
      ]);
      setOpenClawStatus(status);
      setOpenClawConfigDefaultModel(resolveConfigDefaultModel(configResult?.config));
      setOpenClawConfigDefaultModelLoaded(true);
      setGatewayUpdateRestartSentinel(updateStatus?.sentinel ?? null);
      await refreshGatewayStatus();
    } catch (error) {
      console.warn("Failed to load OpenClaw runtime status", error);
      setGatewayUpdateRestartSentinel(null);
      await refreshGatewayStatus();
    }
  }, [refreshGatewayStatus]);

  const refreshOpenClawCliStatus = useCallback(async () => {
    try {
      const status = await invoke<OpenClawCliStatus>("openclaw_cli_status");
      setOpenClawCliStatus(status);
    } catch (error) {
      console.warn("Failed to load OpenClaw CLI version status", error);
    }
  }, []);

  return {
    openClawStatus,
    openClawConfigDefaultModel,
    openClawConfigDefaultModelLoaded,
    openClawCliStatus,
    gatewayUpdateRestartSentinel,
    setOpenClawStatus,
    setOpenClawConfigDefaultModel,
    setOpenClawConfigDefaultModelLoaded,
    setGatewayUpdateRestartSentinel,
    refreshOpenClawDefaultModel,
    refreshOpenClawStatus,
    refreshOpenClawCliStatus,
  };
}
