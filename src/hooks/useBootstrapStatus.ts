import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ClawKitBootstrapStatus } from "../types/app";

export type BootstrapStep = "detect" | "install" | "bind" | "connect_test" | "ready";

export function useBootstrapStatus() {
  const [bootstrapStatus, setBootstrapStatus] = useState<ClawKitBootstrapStatus | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bindingInProgress, setBindingInProgress] = useState(false);
  const [bootstrapStep, setBootstrapStep] = useState<BootstrapStep>("detect");
  const [bootstrapConnectError, setBootstrapConnectError] = useState<string | null>(null);

  const loadBootstrapStatus = useCallback(async () => {
    setBootstrapLoading(true);
    setBootstrapError(null);
    try {
      const status = await invoke<ClawKitBootstrapStatus>("get_clawkit_bootstrap_status");
      setBootstrapStatus(status);
      setBootstrapStep(!status.openclawInstalled ? "install" : status.bindingConfigured ? "ready" : "bind");
    } catch (error) {
      console.error("Failed to load clawkit bootstrap status", error);
      setBootstrapError(error instanceof Error ? error.message : "读取 OpenClaw 状态失败");
    } finally {
      setBootstrapLoading(false);
    }
  }, []);

  const bindOpenClaw = useCallback(async () => {
    setBindingInProgress(true);
    setBootstrapError(null);
    setBootstrapConnectError(null);
    try {
      const status = await invoke<ClawKitBootstrapStatus>("ensure_clawkit_binding");
      setBootstrapStatus(status);
      setBootstrapStep(status.bindingConfigured ? "connect_test" : "bind");
    } catch (error) {
      console.error("Failed to bind OpenClaw config", error);
      setBootstrapError(error instanceof Error ? error.message : "写入 OpenClaw 配置失败");
    } finally {
      setBindingInProgress(false);
    }
  }, []);

  useEffect(() => {
    void loadBootstrapStatus();
  }, [loadBootstrapStatus]);

  useEffect(() => {
    if (!bootstrapStatus?.openclawInstalled || !bootstrapStatus.bindingConfigured || bootstrapStep !== "connect_test") {
      return;
    }

    let cancelled = false;
    void (async () => {
      setBootstrapConnectError(null);
      try {
        await invoke("gateway_connect");
        if (!cancelled) {
          setBootstrapStep("ready");
        }
      } catch (error) {
        console.error("Gateway connect test failed", error);
        if (!cancelled) {
          setBootstrapConnectError(error instanceof Error ? error.message : "Gateway 连接测试失败");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootstrapStatus?.bindingConfigured, bootstrapStatus?.openclawInstalled, bootstrapStep]);

  return {
    bootstrapStatus,
    bootstrapLoading,
    bootstrapError,
    bindingInProgress,
    bootstrapStep,
    bootstrapConnectError,
    loadBootstrapStatus,
    bindOpenClaw,
    setBootstrapStep,
  };
}
