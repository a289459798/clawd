/** Calendar-style OpenClaw CLI builds (e.g. 2026.5.10); ignores prerelease suffix after `-`. */
export const RECOMMENDED_OPENCLAW_CLI_VERSION = "2026.5.10";

/** First upstream release that documents `skills.install.allowUploadedArchives` (zip skill installs via Gateway). */
export const MIN_OPENCLAW_CLI_VERSION_SKILL_ZIP_UPLOAD = "2026.5.10";

function calendarCoreVersion(installed: string): number[] {
  const trimmed = installed.trim().replace(/^v/i, "");
  const core = trimmed.split("-")[0] ?? trimmed;
  return core.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** Returns `< 0` if `a` is older than `b`, `0` if equal on numeric segments, `> 0` if newer. */
export function compareOpenClawCalendarCoreVersion(a: string, b: string): number {
  const pa = calendarCoreVersion(a);
  const pb = calendarCoreVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

export function isOpenClawCliBelowRecommended(installed: string | null | undefined): boolean {
  if (!installed?.trim()) return false;
  return compareOpenClawCalendarCoreVersion(installed.trim(), RECOMMENDED_OPENCLAW_CLI_VERSION) < 0;
}

/** True when `installed` parses as a calendar core version **≥** `minimum` (same rules as compare). */
export function openClawCliMeetsMinimum(installed: string | null | undefined, minimum: string): boolean {
  if (!installed?.trim()) return false;
  return compareOpenClawCalendarCoreVersion(installed.trim(), minimum) >= 0;
}
