import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import { buildBootstrapDebugStatus } from "../lib/appDerivedData";
import type { ClawKitBootstrapStatus } from "../types/app";

const BOOTSTRAP_DEBUG_STORAGE_KEY = "clawkit.debug.bootstrapStep";

function readBootstrapDebugStep() {
  try {
    const value =
      window.localStorage.getItem(BOOTSTRAP_DEBUG_STORAGE_KEY) ??
      window.localStorage.getItem("clawx.debug.bootstrapStep");
    return value === "install" || value === "bind" || value === "connect_test" ? value : null;
  } catch {
    return null;
  }
}

type BootstrapStep = "detect" | "install" | "bind" | "connect_test" | "ready";

export function useBootstrapFlow({
}: {} = {}) {
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
      const debugStep = readBootstrapDebugStep();
      if (debugStep) {
        setBootstrapStatus(buildBootstrapDebugStatus(debugStep));
        setBootstrapStep(debugStep);
        return;
      }
      const status = await invoke<ClawKitBootstrapStatus>("get_clawkit_bootstrap_status");
      setBootstrapStatus(status);
      setBootstrapStep(!status.openclawInstalled ? "install" : status.bindingConfigured ? "ready" : "bind");
    } catch (error) {
      console.error("Failed to load clawkit bootstrap status", error);
      setBootstrapError(error instanceof Error ? error.message : "Failed to read OpenClaw status");
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
      setBootstrapError(error instanceof Error ? error.message : "Failed to write OpenClaw config");
    } finally {
      setBindingInProgress(false);
    }
  }, []);

  return {
    bootstrapStatus,
    bootstrapLoading,
    bootstrapError,
    bindingInProgress,
    bootstrapStep,
    bootstrapConnectError,
    setBootstrapStep,
    setBootstrapConnectError,
    loadBootstrapStatus,
    bindOpenClaw,
  };
}
