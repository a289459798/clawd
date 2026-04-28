import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ClawxBootstrapStatus } from "../types/app";

export type BootstrapStep = "detect" | "install" | "bind" | "connect_test" | "ready";

interface UseBootstrapReturn {
  bootstrapStatus: ClawxBootstrapStatus | null;
  bootstrapLoading: boolean;
  bootstrapError: string | null;
  bindingInProgress: boolean;
  bootstrapStep: BootstrapStep;
  bootstrapConnectError: string | null;
  loadBootstrapStatus: () => Promise<void>;
  bindOpenClaw: () => Promise<void>;
  setBootstrapStep: (step: BootstrapStep) => void;
  setBootstrapConnectError: (error: string | null) => void;
  shouldShowBootstrap: boolean;
}

export function useBootstrap(): UseBootstrapReturn {
  const [bootstrapStatus, setBootstrapStatus] = useState<ClawxBootstrapStatus | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bindingInProgress, setBindingInProgress] = useState(false);
  const [bootstrapStep, setBootstrapStep] = useState<BootstrapStep>("detect");
  const [bootstrapConnectError, setBootstrapConnectError] = useState<string | null>(null);

  const loadBootstrapStatus = useCallback(async () => {
    setBootstrapLoading(true);
    setBootstrapError(null);
    try {
      const status = await invoke<ClawxBootstrapStatus>("get_clawx_bootstrap_status");
      setBootstrapStatus(status);
      setBootstrapStep(!status.openclawInstalled ? "install" : status.bindingConfigured ? "ready" : "bind");
    } catch (error) {
      console.error("Failed to load clawx bootstrap status", error);
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
      const status = await invoke<ClawxBootstrapStatus>("ensure_clawx_binding");
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

  // Handle connect_test step
  useEffect(() => {
    if (!bootstrapStatus?.openclawInstalled || !bootstrapStatus.bindingConfigured) {
      return;
    }

    if (bootstrapStep === "connect_test") {
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
    }
  }, [bootstrapStatus?.bindingConfigured, bootstrapStatus?.openclawInstalled, bootstrapStep]);

  const shouldShowBootstrap = bootstrapLoading
    || Boolean(bootstrapError)
    || !bootstrapStatus?.openclawInstalled
    || !bootstrapStatus?.bindingConfigured
    || bootstrapStep === "connect_test"
    || Boolean(bootstrapConnectError);

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
    setBootstrapConnectError,
    shouldShowBootstrap,
  };
}
