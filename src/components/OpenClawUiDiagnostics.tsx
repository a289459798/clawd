import { useMemo } from "react";
import type { UiFrameDiagnosticsCapabilities } from "../hooks/useUiFrameDiagnostics";
import {
  formatDiagnosticAgeCn,
  slowFrameKindLabel,
  type UiSlowFrameEntry,
} from "../lib/uiFrameDiagnostics";

interface OpenClawUiDiagnosticsProps {
  entries: UiSlowFrameEntry[];
  capabilities: UiFrameDiagnosticsCapabilities;
  onClear: () => void;
  t: (key: string) => string;
}

const tt = (t: (key: string) => string, key: string, fallback: string) => {
  const value = t(key);
  return value === key ? fallback : value;
};

export function OpenClawUiDiagnostics({ entries, capabilities, onClear, t }: OpenClawUiDiagnosticsProps) {
  const nowMs = Date.now();
  const capsLine = useMemo(() => {
    const parts: string[] = [];
    if (capabilities.longAnimationFrame) parts.push(tt(t, "diagnostics.loaf", "Long animation frame (LoAF)"));
    if (capabilities.longTask) parts.push("Long Task");
    return parts.length ? parts.join(" / ") : tt(t, "diagnostics.notEnabled", "Not enabled (current WebView may not support these APIs)");
  }, [capabilities.longAnimationFrame, capabilities.longTask, t]);

  return (
    <details className="openclaw-ui-diagnostics">
      <summary className="openclaw-ui-diagnostics-summary">{tt(t, "diagnostics.title", "Rendering diagnostics (debug)")}</summary>
      <p className="openclaw-ui-diagnostics-hint">
        {tt(t, "diagnostics.hint", "Records slow frames/tasks on main thread for troubleshooting; source: PerformanceObserver")} ({capsLine}).
      </p>
      <div className="openclaw-ui-diagnostics-toolbar">
        <button type="button" className="ghost-link-button" onClick={onClear} disabled={entries.length === 0}>
          {tt(t, "diagnostics.clear", "Clear records")}
        </button>
        <span className="openclaw-ui-diagnostics-count">{entries.length} {tt(t, "diagnostics.records", "records")}</span>
      </div>
      {entries.length === 0 ? (
        <p className="openclaw-ui-diagnostics-empty">{tt(t, "diagnostics.empty", "No records yet. Try again after switching pages or scrolling conversations.")}</p>
      ) : (
        <ul className="openclaw-ui-diagnostics-list">
          {entries.map((item) => (
            <li key={item.id} className="openclaw-ui-diagnostics-row">
              <span className="openclaw-ui-diagnostics-kind">{slowFrameKindLabel(item.kind)}</span>
              <span className="openclaw-ui-diagnostics-duration">{Math.round(item.durationMs)} ms</span>
              <span className="openclaw-ui-diagnostics-age" title={new Date(item.ts).toLocaleString()}>
                {formatDiagnosticAgeCn(nowMs - item.ts)}
              </span>
              {item.detail ? (
                <span className="openclaw-ui-diagnostics-detail" title={item.detail}>
                  {item.detail}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
