export type UiSlowFrameKind = "long-animation-frame" | "longtask";

export interface UiSlowFrameEntry {
  id: string;
  ts: number;
  durationMs: number;
  kind: UiSlowFrameKind;
  /** Optional task name / attribution when provided by the browser. */
  detail?: string;
}

const DEFAULT_MAX = 40;

export function appendSlowFrameEntry(
  prev: UiSlowFrameEntry[],
  next: UiSlowFrameEntry,
  max = DEFAULT_MAX,
): UiSlowFrameEntry[] {
  return [next, ...prev].slice(0, max);
}

export function slowFrameKindLabel(kind: UiSlowFrameKind): string {
  return kind === "long-animation-frame" ? "慢动画帧" : "长任务";
}

export function formatDiagnosticAgeCn(deltaMs: number): string {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return "-";
  if (deltaMs < 45_000) return "刚刚";
  const min = Math.floor(deltaMs / 60_000);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  return `${day} 天前`;
}
