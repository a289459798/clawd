import { OpenClawUiDiagnostics } from "./OpenClawUiDiagnostics";
import type { UiFrameDiagnosticsCapabilities } from "../hooks/useUiFrameDiagnostics";
import type { UiSlowFrameEntry } from "../lib/uiFrameDiagnostics";
import type { OpenClawCliStatus } from "../types/app";
import type { GatewayOpenClawStatusResult } from "../types/gateway";

type TranslateFn = (key: string) => string;

const tt = (t: TranslateFn, key: string, fallback: string) => {
  const value = t(key);
  return value === key ? fallback : value;
};

export function OpenClawInfoModal({
  open,
  t,
  gatewayConnected,
  gatewayStatusText,
  openClawGatewayBusy,
  onClose,
  onToggleGateway,
  openClawStatus,
  gatewayProcessUptimeLabel,
  gatewayRestartSentinelLine,
  uiFrameDiagnostics,
  openClawCliStatus,
  openClawUpdateMessage,
  openClawGatewayMessage,
  openClawUpdateBusy,
  onRunOpenClawUpdate,
  onOpenLocalOpenClaw,
}: {
  open: boolean;
  t: TranslateFn;
  gatewayConnected: boolean;
  gatewayStatusText: string;
  openClawGatewayBusy: boolean;
  onClose: () => void;
  onToggleGateway: () => void;
  openClawStatus: GatewayOpenClawStatusResult | null;
  gatewayProcessUptimeLabel: string | null;
  gatewayRestartSentinelLine: string | null;
  uiFrameDiagnostics: {
    entries: UiSlowFrameEntry[];
    capabilities: UiFrameDiagnosticsCapabilities;
    clear: () => void;
  };
  openClawCliStatus: OpenClawCliStatus | null;
  openClawUpdateMessage: string | null;
  openClawGatewayMessage: string | null;
  openClawUpdateBusy: boolean;
  onRunOpenClawUpdate: () => void;
  onOpenLocalOpenClaw: () => void;
}) {
  if (!open) return null;
  const statusTitle = gatewayConnected
    ? tt(t, "openclaw.modal.connectedTitle", "OpenClaw is ready")
    : tt(t, "openclaw.modal.disconnectedTitle", "OpenClaw is not connected");
  const statusHelp = gatewayConnected
    ? tt(t, "openclaw.modal.connectedHelp", "You can use conversations, agents, models, skills, and scheduled tasks normally.")
    : tt(t, "openclaw.modal.disconnectedHelp", "Start OpenClaw first. ClawKit needs it to read conversations and send messages.");
  const toggleLabel = openClawGatewayBusy
    ? tt(t, "openclaw.modal.working", "Working...")
    : gatewayConnected
      ? tt(t, "openclaw.modal.stop", "Stop OpenClaw")
      : tt(t, "openclaw.modal.start", "Start OpenClaw");

  return (
    <div className="openclaw-info-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="openclaw-info-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="openclaw-info-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="openclaw-info-head">
          <div>
            <strong id="openclaw-info-title">{tt(t, "openclaw.modal.title", "OpenClaw status")}</strong>
            <span>{tt(t, "openclaw.modal.subtitle", "Local engine used by ClawKit")}</span>
          </div>
          <button
            className="icon-only-button"
            type="button"
            onClick={onClose}
            title={tt(t, "common.close", "Close")}
            aria-label={tt(t, "common.close", "Close")}
          >
            ×
          </button>
        </div>

        <section className={`openclaw-status-card ${gatewayConnected ? "connected" : "disconnected"}`}>
          <div className="openclaw-status-main">
            <span className={`status-dot ${gatewayConnected ? "working" : "completed"}`} />
            <div>
              <strong>{statusTitle}</strong>
              <p>{statusHelp}</p>
              <small>{gatewayStatusText}</small>
            </div>
          </div>
          {openClawCliStatus?.updateAvailable ? (
            <p className="openclaw-update-suggestion">{tt(t, "openclaw.modal.updateSuggestion", "A newer OpenClaw version is available. Updating is recommended for the latest fixes and features.")}</p>
          ) : null}
        </section>

        <div className="openclaw-primary-actions">
          {openClawCliStatus?.updateAvailable ? (
            <button className="openclaw-update-button primary" type="button" onClick={onRunOpenClawUpdate} disabled={openClawUpdateBusy}>
              {openClawUpdateBusy ? t("openclaw.openingTerminal") : t("openclaw.update")}
            </button>
          ) : null}
          <button className="openclaw-update-button" type="button" onClick={onToggleGateway} disabled={openClawGatewayBusy}>
            {toggleLabel}
          </button>
          <button className="openclaw-home-button" type="button" onClick={onOpenLocalOpenClaw} title={t("openclaw.openLocal")}>
            {t("openclaw.openLocal")}
          </button>
        </div>

        {openClawUpdateMessage || openClawGatewayMessage || openClawCliStatus?.latestCheckError ? (
          <div className="openclaw-message-list" role="status">
            {openClawUpdateMessage ? <p>{openClawUpdateMessage}</p> : null}
            {openClawGatewayMessage ? <p>{openClawGatewayMessage}</p> : null}
            {openClawCliStatus?.latestCheckError ? <p>{openClawCliStatus.latestCheckError}</p> : null}
          </div>
        ) : null}

        <section className="openclaw-simple-section">
          <h3>{tt(t, "openclaw.modal.commonInfo", "Common info")}</h3>
          <div className="openclaw-info-metrics">
            <div><span>{t("openclaw.sessions")}</span><strong>{openClawStatus?.sessions?.count ?? "-"}</strong></div>
            <div><span>{t("openclaw.defaultModel")}</span><strong>{openClawStatus?.sessions?.defaults?.model || "-"}</strong></div>
            <div><span>{t("openclaw.defaultAgent")}</span><strong>{openClawStatus?.heartbeat?.defaultAgentId || "-"}</strong></div>
          </div>
        </section>

        <details className="openclaw-advanced-details">
          <summary>{tt(t, "openclaw.modal.advanced", "Advanced details")}</summary>
          <div className={`openclaw-update-panel ${openClawCliStatus?.updateAvailable ? "available" : ""}`}>
            <div className="openclaw-update-row">
              <span>{t("openclaw.currentVersion")}</span>
              <strong>{openClawCliStatus?.installedVersion || openClawStatus?.runtimeVersion || "-"}</strong>
            </div>
            <div className="openclaw-update-row">
              <span>{t("openclaw.latestVersion")}</span>
              <strong>{openClawCliStatus?.latestVersion || (openClawCliStatus?.latestCheckError ? t("openclaw.checkFailed") : "-")}</strong>
            </div>
            {gatewayConnected && gatewayProcessUptimeLabel ? (
              <div className="openclaw-update-row">
                <span>{t("openclaw.gatewayUptime")}</span>
                <strong title={t("openclaw.gatewayUptimeHint")}>{t("openclaw.approx")} {gatewayProcessUptimeLabel}</strong>
              </div>
            ) : null}
          </div>
          {gatewayConnected && gatewayRestartSentinelLine ? (
            <p className="openclaw-restart-sentinel-hint">{gatewayRestartSentinelLine}</p>
          ) : null}
          <OpenClawUiDiagnostics
            t={t}
            entries={uiFrameDiagnostics.entries}
            capabilities={uiFrameDiagnostics.capabilities}
            onClear={uiFrameDiagnostics.clear}
          />
        </details>
      </aside>
    </div>
  );
}
