/** Loose Gateway `cron.list` job row — matches OpenClaw `CronJob` JSON shape. */
export type CronJobRow = {
  id: string;
  name?: string;
  description?: string;
  agentId?: string;
  enabled?: boolean;
  schedule?: unknown;
  sessionTarget?: string;
  wakeMode?: string;
  payload?: unknown;
  sessionKey?: string;
  delivery?: { mode?: string; channel?: string; to?: string };
  state?: {
    nextRunAtMs?: number;
    runningAtMs?: number;
    lastRunAtMs?: number;
    lastRunStatus?: string;
    lastDurationMs?: number;
    lastDeliveryStatus?: string;
  };
};

export type CronDeliveryPreviewRow = { label?: string; detail?: string };

export function formatCronSchedule(schedule: unknown): string {
  if (!schedule || typeof schedule !== "object") return "-";
  const s = schedule as Record<string, unknown>;
  if (s.kind === "cron" && typeof s.expr === "string") {
    const tz = typeof s.tz === "string" ? s.tz.trim() : "";
    return tz ? `${s.expr} (${tz})` : s.expr;
  }
  if (s.kind === "every" && typeof s.everyMs === "number") {
    const ms = s.everyMs;
    if (ms >= 86_400_000) return `每 ${Math.round(ms / 86_400_000)} 天`;
    if (ms >= 3_600_000) return `每 ${Math.round(ms / 3_600_000)} 小时`;
    if (ms >= 60_000) return `每 ${Math.round(ms / 60_000)} 分钟`;
    return `每 ${Math.round(ms / 1000)} 秒`;
  }
  if (s.kind === "at" && typeof s.at === "string") return `定时 ${s.at}`;
  return "-";
}

export function formatCronTimestamp(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "-";
  return new Date(value).toLocaleString();
}

export function scheduleKindOf(schedule: unknown): "cron" | "every" | "at" {
  if (!schedule || typeof schedule !== "object") return "cron";
  const kind = (schedule as Record<string, unknown>).kind;
  return kind === "every" || kind === "at" ? kind : "cron";
}

export function scheduleExprOf(schedule: unknown): string {
  if (!schedule || typeof schedule !== "object") return "";
  const s = schedule as Record<string, unknown>;
  return typeof s.expr === "string" ? s.expr : "";
}

export function scheduleTzOf(schedule: unknown): string {
  if (!schedule || typeof schedule !== "object") return "";
  const s = schedule as Record<string, unknown>;
  return typeof s.tz === "string" ? s.tz : "";
}

export function scheduleAtOf(schedule: unknown): string {
  if (!schedule || typeof schedule !== "object") return "";
  const s = schedule as Record<string, unknown>;
  if (typeof s.at !== "string") return "";
  const date = new Date(s.at);
  if (Number.isNaN(date.getTime())) return s.at;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function scheduleEveryMinutesOf(schedule: unknown): string {
  if (!schedule || typeof schedule !== "object") return "60";
  const s = schedule as Record<string, unknown>;
  if (typeof s.everyMs !== "number" || !Number.isFinite(s.everyMs)) return "60";
  return String(Math.max(1, Math.round(s.everyMs / 60_000)));
}

export function describeCronDeliveryLine(
  job: CronJobRow,
  preview?: CronDeliveryPreviewRow | null,
): { text: string; noDelivery: boolean } {
  const mode = job.delivery?.mode;
  if (mode === "none") {
    return { text: "不投递（仅执行任务）", noDelivery: true };
  }
  if (preview?.label && preview.label !== "not requested") {
    return { text: preview.label, noDelivery: false };
  }
  if (preview?.label === "not requested" || preview?.detail === "not requested") {
    return { text: "不投递（仅执行任务）", noDelivery: true };
  }
  if (mode === "announce") {
    const ch = job.delivery?.channel ?? "默认通道";
    const to = job.delivery?.to;
    return { text: to ? `投递 · ${ch} → ${to}` : `投递 · ${ch}`, noDelivery: false };
  }
  if (mode === "webhook") {
    return { text: "投递 · webhook", noDelivery: false };
  }
  return { text: "投递方式未指定", noDelivery: false };
}

export function parseCronListPayload(payload: unknown): {
  jobs: CronJobRow[];
  deliveryPreviews: Record<string, CronDeliveryPreviewRow>;
  total: number;
} {
  if (!payload || typeof payload !== "object") {
    return { jobs: [], deliveryPreviews: {}, total: 0 };
  }
  const o = payload as Record<string, unknown>;
  const rawJobs = o.jobs;
  const jobs: CronJobRow[] = [];
  if (Array.isArray(rawJobs)) {
    for (const item of rawJobs) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (typeof row.id !== "string") continue;
      jobs.push({
        id: row.id,
        name: typeof row.name === "string" ? row.name : undefined,
        description: typeof row.description === "string" ? row.description : undefined,
        agentId: typeof row.agentId === "string" ? row.agentId : undefined,
        enabled: typeof row.enabled === "boolean" ? row.enabled : undefined,
        schedule: row.schedule,
        sessionTarget: typeof row.sessionTarget === "string" ? row.sessionTarget : undefined,
        wakeMode: typeof row.wakeMode === "string" ? row.wakeMode : undefined,
        payload: row.payload,
        sessionKey: typeof row.sessionKey === "string" ? row.sessionKey : undefined,
        delivery:
          row.delivery && typeof row.delivery === "object"
            ? (row.delivery as CronJobRow["delivery"])
            : undefined,
        state: row.state && typeof row.state === "object" ? normalizeCronJobState(row.state) : undefined,
      });
    }
  }
  const previewsRaw = o.deliveryPreviews;
  const deliveryPreviews: Record<string, CronDeliveryPreviewRow> = {};
  if (previewsRaw && typeof previewsRaw === "object") {
    for (const [key, val] of Object.entries(previewsRaw)) {
      if (!val || typeof val !== "object") continue;
      const p = val as Record<string, unknown>;
      deliveryPreviews[key] = {
        label: typeof p.label === "string" ? p.label : undefined,
        detail: typeof p.detail === "string" ? p.detail : undefined,
      };
    }
  }
  const total = typeof o.total === "number" ? o.total : jobs.length;
  return { jobs, deliveryPreviews, total };
}

export function parseCronJobPayload(payload: unknown): CronJobRow | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  if (typeof row.id !== "string") return null;
  return {
    id: row.id,
    name: typeof row.name === "string" ? row.name : undefined,
    description: typeof row.description === "string" ? row.description : undefined,
    agentId: typeof row.agentId === "string" ? row.agentId : undefined,
    enabled: typeof row.enabled === "boolean" ? row.enabled : undefined,
    schedule: row.schedule,
    sessionTarget: typeof row.sessionTarget === "string" ? row.sessionTarget : undefined,
    wakeMode: typeof row.wakeMode === "string" ? row.wakeMode : undefined,
    payload: row.payload,
    sessionKey: typeof row.sessionKey === "string" ? row.sessionKey : undefined,
    delivery:
      row.delivery && typeof row.delivery === "object"
        ? (row.delivery as CronJobRow["delivery"])
        : undefined,
    state: row.state && typeof row.state === "object" ? normalizeCronJobState(row.state) : undefined,
  };
}

function normalizeCronJobState(input: unknown): CronJobRow["state"] {
  if (!input || typeof input !== "object") return undefined;
  const row = input as Record<string, unknown>;
  return {
    nextRunAtMs: typeof row.nextRunAtMs === "number" ? row.nextRunAtMs : undefined,
    runningAtMs: typeof row.runningAtMs === "number" ? row.runningAtMs : undefined,
    lastRunAtMs: typeof row.lastRunAtMs === "number" ? row.lastRunAtMs : undefined,
    lastRunStatus: typeof row.lastRunStatus === "string" ? row.lastRunStatus : typeof row.lastStatus === "string" ? row.lastStatus : undefined,
    lastDurationMs: typeof row.lastDurationMs === "number" ? row.lastDurationMs : undefined,
    lastDeliveryStatus: typeof row.lastDeliveryStatus === "string" ? row.lastDeliveryStatus : undefined,
  };
}

export type CronRunRow = {
  ts: number;
  jobId?: string;
  status?: string;
  sessionKey?: string;
  summary?: string;
};

export function parseCronRunsPayload(payload: unknown): CronRunRow[] {
  if (!payload || typeof payload !== "object") return [];
  const entries = (payload as Record<string, unknown>).entries;
  if (!Array.isArray(entries)) return [];
  const out: CronRunRow[] = [];
  for (const item of entries) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.ts !== "number") continue;
    out.push({
      ts: row.ts,
      jobId: typeof row.jobId === "string" ? row.jobId : undefined,
      status: typeof row.status === "string" ? row.status : undefined,
      sessionKey: typeof row.sessionKey === "string" ? row.sessionKey : undefined,
      summary: typeof row.summary === "string" ? row.summary : undefined,
    });
  }
  return out;
}
