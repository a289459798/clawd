import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ClawKitBootstrapStatus } from "../types/app";

type BootstrapScreensProps = {
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
          <strong>欢迎使用 ClawKit</strong>
          <p>首次启动会先检查本机 OpenClaw 环境，并确认是否允许 ClawKit 访问本地 Gateway。</p>
          <div className="bootstrap-meta">
            <span>步骤 1/3，检测本机 OpenClaw</span>
            <span>当前阶段: {bootstrapStep === "detect" ? "环境检测" : bootstrapStep}</span>
          </div>
        </div>
      </main>
    );
  }

  if (bootstrapError) {
    return (
      <main className="bootstrap-screen">
        <div className="bootstrap-card danger">
          <strong>读取 OpenClaw 状态失败</strong>
          <p>{bootstrapError}</p>
          <div className="bootstrap-actions">
            <button className="ghost-button" type="button" onClick={onLoadBootstrapStatus}>
              重试
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
          <strong>先安装 OpenClaw，才能继续使用 ClawKit</strong>
          <p>ClawKit 本身不托管模型会话，它依赖本机 OpenClaw 提供 Gateway、配置和会话数据。所以第一次使用前，需要先完成 OpenClaw 安装。</p>
          <div className="bootstrap-meta">
            <span>步骤 2/3，等待安装 OpenClaw</span>
            <span>期望配置路径: {bootstrapStatus?.configPath ?? "~/.openclaw/openclaw.json"}</span>
          </div>
          {installMessage ? <p className="bootstrap-inline-status">{installMessage}</p> : null}
          {installError ? <p className="bootstrap-inline-status danger">{installError}</p> : null}
          <div className="bootstrap-actions">
            <button className="ghost-button" type="button" onClick={onLoadBootstrapStatus}>
              我已安装，重新检测
            </button>
            <button className="primary-button" type="button" onClick={() => void startOpenClawInstall()} disabled={installingOpenClaw}>
              {installingOpenClaw ? "正在打开终端..." : "立即安装"}
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
          <strong>连接 OpenClaw</strong>
          <p>为了让 ClawKit 正常读取会话、发消息并接收流式回复，需要先授权它接入本机 OpenClaw Gateway。你确认后，ClawKit 会把下面这些配置写入你的 openclaw.json。</p>
          <div className="bootstrap-meta">
            <span>步骤 3/3，绑定本机 OpenClaw</span>
            <span>OpenClaw: {bootstrapStatus.openclawPath ?? "已安装"}</span>
            <span>配置文件: {bootstrapStatus.configPath}</span>
            <span>Gateway 端口: {bootstrapStatus.gatewayPort ?? 18789}</span>
          </div>
          <div className="code-block-shell">
            <div className="code-block-toolbar">
              <span className="code-block-language">将写入的配置</span>
            </div>
            <pre className="tool-entry-body code terminal-block">{bootstrapStatus.bindingWrites.join("\n")}</pre>
          </div>
          <div className="bootstrap-actions">
            <button className="ghost-button" type="button" onClick={onLoadBootstrapStatus} disabled={bindingInProgress}>
              刷新状态
            </button>
            <button className="primary-button" type="button" onClick={onBindOpenClaw} disabled={bindingInProgress}>
              {bindingInProgress ? "正在写入并绑定..." : "同意并继续"}
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
          <strong>{bootstrapConnectError ? "OpenClaw 连接测试失败" : "正在验证 OpenClaw 连接"}</strong>
          <p>
            {bootstrapConnectError
              ? "配置已经写入，但 ClawKit 还没能成功连上本机 Gateway。你可以重试，或者先检查 OpenClaw Gateway 是否正在运行。"
              : "ClawKit 正在测试 Gateway 连接与流式能力，确认通过后才会进入主界面。"}
          </p>
          <div className="bootstrap-meta">
            <span>当前阶段: 连接测试</span>
            <span>Gateway 端口: {bootstrapStatus.gatewayPort ?? 18789}</span>
            {bootstrapConnectError ? <span>错误: {bootstrapConnectError}</span> : null}
          </div>
          {bootstrapConnectError ? (
            <div className="bootstrap-actions">
              <button className="ghost-button" type="button" onClick={onLoadBootstrapStatus}>
                重新检测环境
              </button>
              <button className="primary-button" type="button" onClick={() => onSetBootstrapStep("connect_test")}>
                重试连接
              </button>
            </div>
          ) : null}
        </div>
      </main>
    );
  }

  return null;
}
