/** Human-readable duration for Gateway uptime hints (Chinese). */
export function formatApproxDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr} 小时 ${min % 60} 分`;
  const day = Math.floor(hr / 24);
  return `${day} 天 ${hr % 24} 小时`;
}

/** Linear extrapolation from last hello snapshot (`basis + now - recordedAt`). */
export function extrapolateGatewayUptimeMs(params: {
  basisMs: number | null;
  recordedAtMs: number | null;
  nowMs?: number;
}): number | null {
  const { basisMs, recordedAtMs, nowMs = Date.now() } = params;
  if (basisMs == null || recordedAtMs == null) return null;
  return basisMs + Math.max(0, nowMs - recordedAtMs);
}

function formatRelativeCn(tsMs: number, nowMs: number): string {
  const delta = Math.max(0, nowMs - tsMs);
  if (delta < 45_000) return "刚刚";
  const min = Math.floor(delta / 60_000);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  return `${day} 天前`;
}

/**
 * One-line explanation of `update.status` restart sentinel for ordinary users.
 * Returns null when there is nothing meaningful to show.
 */
export function describeUpdateRestartSentinel(sentinel: unknown, nowMs = Date.now()): string | null {
  if (sentinel == null) return null;
  if (typeof sentinel !== "object") return null;
  const s = sentinel as Record<string, unknown>;
  const ts = typeof s.ts === "number" && Number.isFinite(s.ts) ? s.ts : null;
  const status = typeof s.status === "string" ? s.status : null;
  const kind = typeof s.kind === "string" ? s.kind : null;
  if (ts == null || status == null) return null;

  const rel = formatRelativeCn(ts, nowMs);
  const stats = s.stats && typeof s.stats === "object" ? (s.stats as Record<string, unknown>) : null;
  const after =
    stats?.after && typeof stats.after === "object" ? (stats.after as Record<string, unknown>) : null;
  const version = typeof after?.version === "string" ? after.version : null;

  if (status === "ok") {
    if (kind === "update") {
      return version
        ? `最近一次更新重启已成功（${rel}），当前运行版本 ${version}`
        : `最近一次更新重启已成功（${rel}）`;
    }
    return version ? `最近一次维护重启已成功（${rel}），版本 ${version}` : `最近一次维护重启已成功（${rel}）`;
  }
  if (status === "error") {
    return `最近一次重启相关流程未完全成功（${rel}）。若连接异常，可在终端查看日志或使用诊断导出`;
  }
  if (status === "skipped") {
    return `最近一次本应执行的重启被跳过（${rel}）`;
  }
  return `最近一条重启记录：${status}（${rel}）`;
}
