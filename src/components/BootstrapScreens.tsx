import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ClawKitBootstrapStatus } from "../types/app";

type TranslateFn = (key: string) => string;
const tt = (t: TranslateFn, key: string, fallback: string) => {
  const value = t(key);
  return value === key ? fallback : value;
};

type BootstrapScreensProps = {
  t: TranslateFn;
  bootstrapLoading: boolean;
  bootstrapError: string | null;
  bootstrapStatus: ClawKitBootstrapStatus | null;
  bootstrapStep: "detect" | "install" | "bind" | "connect_test" | "ready";
  bootstrapConnectError: string | null;
  bindingInProgress: boolean;
  onLoadBootstrapStatus: () => void;
  onBindOpenClaw: () => void;
  onSetBootstrapStep: (step: "detect" | "install" | "bind" | "connect_test" | "ready") => void;
};

export function BootstrapScreens({
  t,
  bootstrapLoading,
  bootstrapError,
  bootstrapStatus,
  bootstrapStep,
  bootstrapConnectError,
  bindingInProgress,
  onLoadBootstrapStatus,
  onBindOpenClaw,
  onSetBootstrapStep,
}: BootstrapScreensProps) {
  const [installingOpenClaw, setInstallingOpenClaw] = useState(false);
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const startOpenClawInstall = async () => {
    setInstallingOpenClaw(true);
    setInstallError(null);
    setInstallMessage(null);
    try {
      const message = await invoke<string>("open_openclaw_install_terminal");
      setInstallMessage(message);
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error));
    } finally {
      setInstallingOpenClaw(false);
    }
  };

  if (bootstrapLoading) {
    return (
      <main className="bootstrap-screen">
        <div className="bootstrap-card">
          <strong>{tt(t, "bootstrap.welcome", "Welcome to ClawKit")}</strong>
          <p>{tt(t, "bootstrap.intro", "On first launch, ClawKit checks your local OpenClaw environment and verifies Gateway access.")}</p>
          <div className="bootstrap-meta">
            <span>{tt(t, "bootstrap.step1", "Step 1/3: detect local OpenClaw")}</span>
            <span>{tt(t, "bootstrap.currentStage", "Current stage")}: {bootstrapStep === "detect" ? tt(t, "bootstrap.stageDetect", "environment detection") : bootstrapStep}</span>
          </div>
        </div>
      </main>
    );
  }

  if (bootstrapError) {
    return (
      <main className="bootstrap-screen">
        <div className="bootstrap-card danger">
          <strong>{tt(t, "bootstrap.loadFailed", "Failed to read OpenClaw status")}</strong>
          <p>{bootstrapError}</p>
          <div className="bootstrap-actions">
            <button className="ghost-button" type="button" onClick={onLoadBootstrapStatus}>
              {tt(t, "common.retry", "Retry")}
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!bootstrapStatus?.openclawInstalled) {
    return (
      <main className="bootstrap-screen">
        <div className="bootstrap-card">
          <strong>{tt(t, "bootstrap.installRequired", "Install OpenClaw before continuing with ClawKit")}</strong>
          <p>{tt(t, "bootstrap.installHint", "ClawKit depends on local OpenClaw for Gateway, config, and session data. Please install OpenClaw first.")}</p>
          <div className="bootstrap-meta">
            <span>{tt(t, "bootstrap.step2", "Step 2/3: install OpenClaw")}</span>
            <span>{tt(t, "bootstrap.expectedConfigPath", "Expected config path")}: {bootstrapStatus?.configPath ?? "~/.openclaw/openclaw.json"}</span>
          </div>
          {installMessage ? <p className="bootstrap-inline-status">{installMessage}</p> : null}
          {installError ? <p className="bootstrap-inline-status danger">{installError}</p> : null}
          <div className="bootstrap-actions">
            <button className="ghost-button" type="button" onClick={onLoadBootstrapStatus}>
              {tt(t, "bootstrap.recheckAfterInstall", "I have installed it, recheck")}
            </button>
            <button className="primary-button" type="button" onClick={() => void startOpenClawInstall()} disabled={installingOpenClaw}>
              {installingOpenClaw ? tt(t, "bootstrap.openingTerminal", "Opening terminal...") : tt(t, "bootstrap.installNow", "Install now")}
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!bootstrapStatus?.bindingConfigured) {
    return (
      <main className="bootstrap-screen">
        <div className="bootstrap-card">
          <strong>{tt(t, "bootstrap.connectTitle", "Connect OpenClaw")}</strong>
          <p>{tt(t, "bootstrap.connectHint", "Authorize ClawKit to access your local OpenClaw Gateway. After confirmation, ClawKit writes the following settings to openclaw.json.")}</p>
          <div className="bootstrap-meta">
            <span>{tt(t, "bootstrap.step3", "Step 3/3: bind local OpenClaw")}</span>
            <span>OpenClaw: {bootstrapStatus.openclawPath ?? tt(t, "connections.installed", "Installed")}</span>
            <span>{tt(t, "bootstrap.configFile", "Config file")}: {bootstrapStatus.configPath}</span>
            <span>Gateway {tt(t, "bootstrap.port", "port")}: {bootstrapStatus.gatewayPort ?? 18789}</span>
          </div>
          <div className="code-block-shell">
            <div className="code-block-toolbar">
              <span className="code-block-language">{tt(t, "bootstrap.bindingWrites", "Settings to be written")}</span>
            </div>
            <pre className="tool-entry-body code terminal-block">{bootstrapStatus.bindingWrites.join("\n")}</pre>
          </div>
          <div className="bootstrap-actions">
            <button className="ghost-button" type="button" onClick={onLoadBootstrapStatus} disabled={bindingInProgress}>
              {tt(t, "settings.openclaw.refresh", "Refresh status")}
            </button>
            <button className="primary-button" type="button" onClick={onBindOpenClaw} disabled={bindingInProgress}>
              {bindingInProgress ? tt(t, "bootstrap.binding", "Writing and binding...") : tt(t, "bootstrap.approveContinue", "Approve and continue")}
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (bootstrapStep === "connect_test" || bootstrapConnectError) {
    return (
      <main className={`bootstrap-screen`}>
        <div className={`bootstrap-card ${bootstrapConnectError ? "danger" : ""}`}>
          <strong>{bootstrapConnectError ? tt(t, "bootstrap.connectTestFailed", "OpenClaw connection test failed") : tt(t, "bootstrap.connectVerifying", "Verifying OpenClaw connection")}</strong>
          <p>
            {bootstrapConnectError
              ? tt(t, "bootstrap.connectTestFailedHint", "Settings were written, but ClawKit still cannot connect to local Gateway. Retry or check whether Gateway is running.")
              : tt(t, "bootstrap.connectTesting", "ClawKit is testing Gateway connectivity and streaming before entering the main workspace.")}
          </p>
          <div className="bootstrap-meta">
            <span>{tt(t, "bootstrap.currentStage", "Current stage")}: {tt(t, "bootstrap.connectTest", "connection test")}</span>
            <span>Gateway {tt(t, "bootstrap.port", "port")}: {bootstrapStatus.gatewayPort ?? 18789}</span>
            {bootstrapConnectError ? <span>{tt(t, "common.error", "Error")}: {bootstrapConnectError}</span> : null}
          </div>
          {bootstrapConnectError ? (
            <div className="bootstrap-actions">
              <button className="ghost-button" type="button" onClick={onLoadBootstrapStatus}>
                {tt(t, "bootstrap.recheckEnv", "Recheck environment")}
              </button>
              <button className="primary-button" type="button" onClick={() => onSetBootstrapStep("connect_test")}>
                {tt(t, "bootstrap.retryConnect", "Retry connection")}
              </button>
            </div>
          ) : null}
        </div>
      </main>
    );
  }

  return null;
}
