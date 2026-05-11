import { OpenClawUiDiagnostics } from "./OpenClawUiDiagnostics";
import type { UiFrameDiagnosticsCapabilities } from "../hooks/useUiFrameDiagnostics";
import type { UiSlowFrameEntry } from "../lib/uiFrameDiagnostics";
import type { OpenClawCliStatus } from "../types/app";
import type { GatewayOpenClawStatusResult } from "../types/gateway";

type TranslateFn = (key: string) => string;

export function OpenClawInfoDrawer({
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
  return (
    <div className="openclaw-info-backdrop" onMouseDown={onClose}>
      <aside
        className="openclaw-info-drawer"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="openclaw-info-head">
          <div className="openclaw-info-status">
            <span className={`status-dot ${gatewayConnected ? "working" : "completed"}`} />
            <div>
              <strong>{gatewayConnected ? t("app.openclawConnected") : t("app.openclawDisconnected")}</strong>
              <span>{gatewayStatusText}</span>
            </div>
          </div>
          <button
            className={`openclaw-connect-switch ${openClawGatewayBusy ? "busy" : ""}`}
            type="button"
            title={gatewayConnected ? t("openclaw.stopGateway") : t("openclaw.startGateway")}
            aria-label={gatewayConnected ? t("openclaw.stopGateway") : t("openclaw.startGateway")}
            aria-pressed={gatewayConnected}
            disabled={openClawGatewayBusy}
            onClick={onToggleGateway}
          >
            <input
              type="checkbox"
              checked={gatewayConnected}
              readOnly
              tabIndex={-1}
            />
            <span />
          </button>
        </div>
        <div className="openclaw-info-metrics">
          <div><span>{t("openclaw.sessions")}</span><strong>{openClawStatus?.sessions?.count ?? "-"}</strong></div>
          <div><span>{t("openclaw.defaultModel")}</span><strong>{openClawStatus?.sessions?.defaults?.model || "-"}</strong></div>
          <div><span>{t("openclaw.defaultAgent")}</span><strong>{openClawStatus?.heartbeat?.defaultAgentId || "-"}</strong></div>
          {gatewayConnected && gatewayProcessUptimeLabel ? (
            <div><span>{t("openclaw.gatewayUptime")}</span><strong title={t("openclaw.gatewayUptimeHint")}>{t("openclaw.approx")} {gatewayProcessUptimeLabel}</strong></div>
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
        <div className={`openclaw-update-panel ${openClawCliStatus?.updateAvailable ? "available" : ""}`}>
          <div className="openclaw-update-row">
            <span>{t("openclaw.currentVersion")}</span>
            <strong>{openClawCliStatus?.installedVersion || openClawStatus?.runtimeVersion || "-"}</strong>
          </div>
          <div className="openclaw-update-row">
            <span>{t("openclaw.latestVersion")}</span>
            <strong>{openClawCliStatus?.latestVersion || (openClawCliStatus?.latestCheckError ? t("openclaw.checkFailed") : "-")}</strong>
          </div>
          {openClawCliStatus?.latestCheckError ? (
            <p className="openclaw-update-note">{openClawCliStatus.latestCheckError}</p>
          ) : null}
          {openClawUpdateMessage ? <p className="openclaw-update-note">{openClawUpdateMessage}</p> : null}
          {openClawGatewayMessage ? <p className="openclaw-update-note">{openClawGatewayMessage}</p> : null}
          {openClawCliStatus?.updateAvailable ? (
            <button className="openclaw-update-button" type="button" onClick={onRunOpenClawUpdate} disabled={openClawUpdateBusy}>
              {openClawUpdateBusy ? t("openclaw.openingTerminal") : t("openclaw.update")}
            </button>
          ) : null}
        </div>
        <div className="openclaw-info-actions">
          <button className="openclaw-home-button" type="button" onClick={onOpenLocalOpenClaw} title={t("openclaw.openLocal")}>
            <span>⌂</span>
            {t("openclaw.openLocal")}
          </button>
        </div>
      </aside>
    </div>
  );
}
