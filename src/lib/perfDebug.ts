const DEFAULT_SLOW_MS = 700;

function perfDebugEnabled() {
  try {
    return window.localStorage.getItem("clawkit.perfDebug") === "1";
  } catch {
    return false;
  }
}

function shouldLog(durationMs: number, thresholdMs: number) {
  return perfDebugEnabled() || durationMs >= thresholdMs;
}

export async function measureAsync<T>(
  label: string,
  action: () => Promise<T>,
  thresholdMs = DEFAULT_SLOW_MS,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await action();
  } finally {
    const durationMs = performance.now() - startedAt;
    if (shouldLog(durationMs, thresholdMs)) {
      console.info(`[clawkit perf] ${label}: ${durationMs.toFixed(0)}ms`);
    }
  }
}
