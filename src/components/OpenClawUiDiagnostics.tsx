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
}

export function OpenClawUiDiagnostics({ entries, capabilities, onClear }: OpenClawUiDiagnosticsProps) {
  const nowMs = Date.now();
  const capsLine = useMemo(() => {
    const parts: string[] = [];
    if (capabilities.longAnimationFrame) parts.push("慢动画帧 LoAF");
    if (capabilities.longTask) parts.push("Long Task");
    return parts.length ? parts.join("、") : "未启用（当前 WebView 可能不支持相关 API）";
  }, [capabilities.longAnimationFrame, capabilities.longTask]);

  return (
    <details className="openclaw-ui-diagnostics">
      <summary className="openclaw-ui-diagnostics-summary">渲染诊断（调试）</summary>
      <p className="openclaw-ui-diagnostics-hint">
        记录主线程阻塞较长的帧与任务，仅供排查卡顿；数据来源 PerformanceObserver（{capsLine}）。
      </p>
      <div className="openclaw-ui-diagnostics-toolbar">
        <button type="button" className="ghost-link-button" onClick={onClear} disabled={entries.length === 0}>
          清空记录
        </button>
        <span className="openclaw-ui-diagnostics-count">{entries.length} 条</span>
      </div>
      {entries.length === 0 ? (
        <p className="openclaw-ui-diagnostics-empty">暂无记录；切换页面或滚动对话后再查看。</p>
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
