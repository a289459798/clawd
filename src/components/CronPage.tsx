import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  describeCronDeliveryLine,
  formatCronSchedule,
  formatCronTimestamp,
  parseCronJobPayload,
  parseCronListPayload,
  parseCronRunsPayload,
  scheduleAtOf,
  scheduleEveryMinutesOf,
  scheduleExprOf,
  scheduleKindOf,
  scheduleTzOf,
  type CronJobRow,
  type CronRunRow,
} from "../lib/cronGateway";
import { CRON_TEMPLATES } from "../lib/cronTemplates";

type CronPageProps = {
  gatewayConnected: boolean;
  t: (key: string) => string;
  agents?: Array<{ id: string; name?: string }>;
  /** Navigate to chat tab and focus session key */
  onOpenSessionKey: (sessionKey: string) => void;
};
const tt = (t: (key: string) => string, key: string, fallback: string) => {
  const value = t(key);
  return value === key ? fallback : value;
};

type CronEditDraft = {
  id?: string;
  name: string;
  description: string;
  payloadText: string;
  enabled: boolean;
  scheduleKind: "cron" | "every" | "at";
  cronExpr: string;
  cronTz: string;
  everyMinutes: string;
  atLocal: string;
  sendMode: "notify" | "silent" | "isolated" | "webhook";
  deliveryChannel: string;
  deliveryTo: string;
  agentId: string;
};

type CronRunNotice = {
  runId?: string;
  status: "queued" | "found" | "missing" | "error";
  message?: string;
};

function defaultAtLocalValue() {
  const next = new Date(Date.now() + 60 * 60_000);
  next.setMinutes(0, 0, 0);
  const local = new Date(next.getTime() - next.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatRunTs(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function extractCronRunId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const row = payload as Record<string, unknown>;
  if (typeof row.runId === "string") return row.runId;
  const data = row.data;
  if (data && typeof data === "object" && typeof (data as Record<string, unknown>).runId === "string") {
    return (data as Record<string, unknown>).runId as string;
  }
  return undefined;
}

function mergeCronRuns(existing: CronRunRow[] | undefined, incoming: CronRunRow[]): CronRunRow[] {
  if (!existing?.length) return incoming;
  if (!incoming.length) return existing;
  const seen = new Set<string>();
  const merged: CronRunRow[] = [];
  for (const row of [...incoming, ...existing]) {
    const key = row.runId || `${row.ts}:${row.jobId ?? ""}:${row.status ?? ""}:${row.sessionKey ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return merged;
}

export function CronPage({ agents = [], gatewayConnected, onOpenSessionKey, t }: CronPageProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listPayload, setListPayload] = useState<unknown>(null);
  const [expandedRunJobId, setExpandedRunJobId] = useState<string | null>(null);
  const [runsByJob, setRunsByJob] = useState<Record<string, CronRunRow[]>>({});
  const [runsLoadingJobId, setRunsLoadingJobId] = useState<string | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<CronEditDraft | null>(null);
  const [runNotices, setRunNotices] = useState<Record<string, CronRunNotice>>({});

  const parsed = useMemo(() => parseCronListPayload(listPayload), [listPayload]);
  const expandedRunJob = parsed.jobs.find((job) => job.id === expandedRunJobId) ?? null;
  const enabledCount = parsed.jobs.filter((job) => job.enabled !== false).length;
  const disabledCount = parsed.jobs.length - enabledCount;
  const deliveryCount = parsed.jobs.filter((job) => !describeCronDeliveryLine(job, parsed.deliveryPreviews[job.id] ?? null, t).noDelivery).length;

  const loadList = useCallback(async () => {
    if (!gatewayConnected) {
      setListPayload(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, unknown> = {
        includeDisabled: true,
        limit: 100,
        sortBy: "nextRunAtMs",
        sortDir: "asc",
      };
      const raw = await invoke<unknown>("gateway_cron_list", { params });
      setListPayload(raw);
    } catch (err) {
      setError(err instanceof Error ? err.message : tt(t, "cron.loadFailed", "Failed to load cron jobs"));
      setListPayload(null);
    } finally {
      setLoading(false);
    }
  }, [gatewayConnected]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const toggleRuns = async (jobId: string) => {
    if (expandedRunJobId === jobId) {
      setExpandedRunJobId(null);
      return;
    }
    setExpandedRunJobId(jobId);
    if (runsByJob[jobId]) return;
    setRunsLoadingJobId(jobId);
    try {
      const raw = await invoke<unknown>("gateway_cron_runs", {
        params: { id: jobId, limit: 25, sortDir: "desc" },
      });
      setRunsByJob((prev) => ({ ...prev, [jobId]: parseCronRunsPayload(raw) }));
    } catch {
      setRunsByJob((prev) => ({ ...prev, [jobId]: [] }));
    } finally {
      setRunsLoadingJobId(null);
    }
  };

  const refreshAfterMutation = async () => {
    setRunsByJob({});
    await loadList();
  };

  const updateJob = async (jobId: string, patch: Record<string, unknown>) => {
    setBusyJobId(jobId);
    setError(null);
    try {
      await invoke<unknown>("gateway_cron_update", { params: { id: jobId, patch } });
      await refreshAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyJobId(null);
    }
  };

  const removeJob = async (job: CronJobRow) => {
    const title = job.name?.trim() || job.id;
    if (!window.confirm(`${tt(t, "cron.deleteConfirmPrefix", "Delete cron job")} "${title}"? ${tt(t, "cron.deleteConfirmSuffix", "This action cannot be undone.")}`)) return;
    setBusyJobId(job.id);
    setError(null);
    try {
      await invoke<unknown>("gateway_cron_remove", { params: { id: job.id } });
      if (expandedRunJobId === job.id) setExpandedRunJobId(null);
      await refreshAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyJobId(null);
    }
  };

  const runJob = async (job: CronJobRow) => {
    setBusyJobId(job.id);
    setError(null);
    try {
      const runPayload = await invoke<unknown>("gateway_cron_run", { params: { id: job.id, mode: "force" } });
      const runId = extractCronRunId(runPayload);
      setExpandedRunJobId(job.id);
      setRunNotices((prev) => ({
        ...prev,
        [job.id]: {
          runId,
          status: "queued",
        },
      }));
      const rawRuns = await invoke<unknown>("gateway_cron_runs", {
        params: runId
          ? { id: job.id, runId, limit: 1, sortDir: "desc" }
          : { id: job.id, limit: 25, sortDir: "desc" },
      });
      const exactRuns = parseCronRunsPayload(rawRuns);
      let nextRuns = exactRuns;
      if (runId && exactRuns.length === 0) {
        const recentRuns = await invoke<unknown>("gateway_cron_runs", {
          params: { id: job.id, limit: 25, sortDir: "desc" },
        });
        nextRuns = parseCronRunsPayload(recentRuns);
      }
      setRunsByJob((prev) => ({ ...prev, [job.id]: mergeCronRuns(prev[job.id], nextRuns) }));
      setExpandedRunJobId(job.id);
      setRunNotices((prev) => ({
        ...prev,
        [job.id]: {
          runId,
          status: exactRuns.length > 0 || (!runId && nextRuns.length > 0) ? "found" : "missing",
        },
      }));
      await loadList();
    } catch (err) {
      setRunNotices((prev) => ({
        ...prev,
        [job.id]: {
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        },
      }));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyJobId(null);
    }
  };

  const makeEditDraft = (job: CronJobRow): CronEditDraft => {
    const sendMode = resolveCronSendMode(job);
    return {
      id: job.id,
      name: job.name ?? job.id,
      description: job.description ?? "",
      payloadText: cronPayloadTextOf(job.payload),
      enabled: job.enabled !== false,
      scheduleKind: scheduleKindOf(job.schedule),
      cronExpr: scheduleExprOf(job.schedule) || "* * * * *",
      cronTz: scheduleTzOf(job.schedule),
      everyMinutes: scheduleEveryMinutesOf(job.schedule),
      atLocal: scheduleAtOf(job.schedule),
      sendMode,
      deliveryChannel: job.delivery?.channel ?? "",
      deliveryTo: job.delivery?.to ?? "",
      agentId: job.agentId ?? "",
    };
  };

  const openEdit = async (job: CronJobRow) => {
    setBusyJobId(job.id);
    setError(null);
    try {
      const raw = await invoke<unknown>("gateway_cron_get", { params: { id: job.id } });
      const canonical = parseCronJobPayload(raw);
      setEditDraft(makeEditDraft(canonical ?? job));
    } catch (err) {
      setError(err instanceof Error ? err.message : tt(t, "cron.getFailed", "Failed to load the latest cron job before editing."));
    } finally {
      setBusyJobId(null);
    }
  };

  const openCreate = () => {
    setEditDraft({
      name: "",
      description: "",
      payloadText: "",
      enabled: true,
      scheduleKind: "cron",
      cronExpr: "0 9 * * *",
      cronTz: "Asia/Shanghai",
      everyMinutes: "60",
      atLocal: defaultAtLocalValue(),
      sendMode: "notify",
      deliveryChannel: "",
      deliveryTo: "",
      agentId: "",
    });
  };

  const saveEditDraft = async (draft: CronEditDraft) => {
    const patch = buildCronPatchFromDraft(draft, !draft.id, t);
    if (!patch) return;
    setEditDraft(null);
    if (draft.id) {
      await updateJob(draft.id, patch);
      return;
    }
    setBusyJobId("__create__");
    setError(null);
    try {
      await invoke<unknown>("gateway_cron_add", { params: buildCronCreateFromPatch(patch) });
      await refreshAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyJobId(null);
    }
  };

  if (!gatewayConnected) {
    return (
      <section className="single-page cron-page">
        <div className="empty-panel">{tt(t, "cron.connectGatewayFirst", "Please connect OpenClaw Gateway first to load cron jobs.")}</div>
      </section>
    );
  }

  return (
    <section className="single-page cron-page">
      <div className="cron-summary-grid">
        <div className="cron-summary-stat"><span>{tt(t, "cron.stat.jobs", "Jobs")}</span><strong>{parsed.total || parsed.jobs.length}</strong></div>
        <div className="cron-summary-stat"><span>{tt(t, "cron.stat.enabled", "Enabled")}</span><strong>{enabledCount}</strong></div>
        <div className="cron-summary-stat"><span>{tt(t, "cron.stat.delivery", "Delivery")}</span><strong>{deliveryCount}</strong></div>
        <div className="cron-summary-stat"><span>{tt(t, "cron.stat.disabled", "Disabled")}</span><strong>{disabledCount}</strong></div>
      </div>

      <div className="cron-toolbar">
        <span />
        <button type="button" className="ghost-link-button" onClick={openCreate} disabled={loading || busyJobId !== null}>
          {tt(t, "common.create", "Create")}
        </button>
        <button type="button" className="ghost-link-button primary-action" onClick={() => void loadList()} disabled={loading}>
          {loading ? tt(t, "common.refreshing", "Refreshing") : tt(t, "common.refresh", "Refresh")}
        </button>
      </div>

      {error ? <div className="inline-page-status cron-error">{error}</div> : null}
      {loading && !parsed.jobs.length ? <div className="inline-page-status">{tt(t, "cron.loading", "Loading cron jobs...")}</div> : null}

      {!loading && !error && parsed.jobs.length === 0 ? (
        <div className="empty-panel">{tt(t, "cron.empty", "No cron jobs under current filters.")}</div>
      ) : null}

      <div className="cron-job-list">
        {parsed.jobs.map((job) => (
          <CronJobCard
            key={job.id}
            job={job}
            preview={parsed.deliveryPreviews[job.id]}
            runNotice={runNotices[job.id]}
            busy={busyJobId === job.id}
            onToggleRuns={() => void toggleRuns(job.id)}
            onOpenSessionKey={onOpenSessionKey}
            onRun={() => void runJob(job)}
            onEdit={() => void openEdit(job)}
            onToggleEnabled={() => void updateJob(job.id, { enabled: job.enabled === false })}
            onDelete={() => void removeJob(job)}
            t={t}
          />
        ))}
      </div>
      {editDraft ? (
        <CronEditDialog
          draft={editDraft}
          busy={editDraft.id ? busyJobId === editDraft.id : busyJobId === "__create__"}
          onChange={setEditDraft}
          onCancel={() => setEditDraft(null)}
          onSubmit={() => void saveEditDraft(editDraft)}
          agents={agents}
          t={t}
        />
      ) : null}
      {expandedRunJob ? (
        <CronRunsDialog
          job={expandedRunJob}
          runs={runsByJob[expandedRunJob.id]}
          runsLoading={runsLoadingJobId === expandedRunJob.id}
          onClose={() => setExpandedRunJobId(null)}
          onOpenSessionKey={onOpenSessionKey}
          t={t}
        />
      ) : null}
    </section>
  );
}

function buildCronPatchFromDraft(draft: CronEditDraft, requirePayload: boolean, t: (key: string) => string): Record<string, unknown> | null {
  const name = draft.name.trim();
  if (!name) {
    window.alert(tt(t, "cron.alert.nameRequired", "Job name is required."));
    return null;
  }
  const patch: Record<string, unknown> = {
    name,
    description: draft.description.trim(),
    enabled: draft.enabled,
    agentId: draft.agentId.trim() || null,
  };
  const payloadText = draft.payloadText.trim();
  if (requirePayload && !payloadText) {
    window.alert(tt(t, "cron.alert.payloadRequired", "Job content is required when creating."));
    return null;
  }
  if (draft.sendMode === "webhook" && !draft.deliveryTo.trim()) {
    window.alert(tt(t, "cron.alert.webhookRequired", "Webhook URL is required."));
    return null;
  }
  Object.assign(patch, buildSendModePatch(draft, payloadText));

  if (draft.scheduleKind === "cron") {
    const expr = draft.cronExpr.trim();
    if (!expr) {
      window.alert(tt(t, "cron.alert.cronRequired", "Cron expression is required."));
      return null;
    }
    patch.schedule = {
      kind: "cron",
      expr,
      ...(draft.cronTz.trim() ? { tz: draft.cronTz.trim() } : {}),
    };
  } else if (draft.scheduleKind === "every") {
    const minutes = Number(draft.everyMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      window.alert(tt(t, "cron.alert.everyMinutesInvalid", "Interval minutes must be greater than 0."));
      return null;
    }
    patch.schedule = { kind: "every", everyMs: Math.round(minutes * 60_000) };
  } else {
    if (!draft.atLocal) {
      window.alert(tt(t, "cron.alert.atRequired", "Scheduled time is required."));
      return null;
    }
    patch.schedule = { kind: "at", at: new Date(draft.atLocal).toISOString() };
  }

  return patch;
}

function buildSendModePatch(draft: CronEditDraft, payloadText: string): Record<string, unknown> {
  if (draft.sendMode === "notify") {
    return {
      sessionTarget: "isolated",
      wakeMode: "now",
      ...(payloadText ? { payload: { kind: "agentTurn", message: payloadText } } : {}),
      delivery: {
        mode: "announce",
        ...(draft.deliveryChannel.trim() ? { channel: draft.deliveryChannel.trim() } : {}),
        ...(draft.deliveryTo.trim() ? { to: draft.deliveryTo.trim() } : {}),
      },
    };
  }
  if (draft.sendMode === "isolated") {
    return {
      sessionTarget: "isolated",
      wakeMode: "now",
      ...(payloadText ? { payload: { kind: "agentTurn", message: payloadText } } : {}),
      delivery: { mode: "none" },
    };
  }
  if (draft.sendMode === "webhook") {
    return {
      sessionTarget: "isolated",
      wakeMode: "now",
      ...(payloadText ? { payload: { kind: "agentTurn", message: payloadText } } : {}),
      delivery: { mode: "webhook", to: draft.deliveryTo.trim() },
    };
  }
  return {
    sessionTarget: "main",
    wakeMode: "now",
    ...(payloadText ? { payload: { kind: "systemEvent", text: payloadText } } : {}),
    delivery: { mode: "none" },
  };
}

function resolveCronSendMode(job: CronJobRow): CronEditDraft["sendMode"] {
  if (job.delivery?.mode === "webhook") return "webhook";
  if (job.delivery?.mode === "announce") return "notify";
  if (job.sessionTarget === "isolated") return "isolated";
  return "silent";
}

function cronPayloadTextOf(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const row = payload as Record<string, unknown>;
  if (typeof row.text === "string") return row.text;
  if (typeof row.message === "string") return row.message;
  return "";
}

function buildCronCreateFromPatch(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    ...patch,
  };
}

function describeCronSendMode(job: CronJobRow, deliveryText: string, t: (key: string) => string): string {
  const mode = resolveCronSendMode(job);
  if (mode === "notify") return `${tt(t, "cron.send.notify", "Notify")} · ${deliveryText}`;
  if (mode === "silent") return tt(t, "cron.send.silent", "Silent · Run without notification");
  if (mode === "isolated") return tt(t, "cron.send.isolated", "Isolated session · Run in own session");
  return tt(t, "cron.send.webhook", "Webhook · Send result to URL");
}

function describeRunNotice(notice: CronRunNotice, t: (key: string) => string): string {
  if (notice.status === "found") return tt(t, "cron.runNotice.found", "This run has started. The latest record is shown below.");
  if (notice.status === "missing") return tt(t, "cron.runNotice.missing", "Run has been queued. The run record may appear after OpenClaw finishes scheduling it.");
  if (notice.status === "error") return notice.message || tt(t, "cron.runNotice.error", "Run failed to start.");
  return tt(t, "cron.runNotice.queued", "Run has been queued.");
}

function cronStatusLabel(status: string | undefined, t: (key: string) => string): string {
  if (!status) return "-";
  const normalized = status.toLowerCase();
  if (normalized === "ok" || normalized === "success" || normalized === "completed") return tt(t, "cron.status.ok", "Completed");
  if (normalized === "error" || normalized === "failed") return tt(t, "cron.status.error", "Failed");
  if (normalized === "skipped") return tt(t, "cron.status.skipped", "Skipped");
  if (normalized === "running") return tt(t, "cron.status.running", "Running");
  if (normalized === "queued" || normalized === "pending") return tt(t, "cron.status.queued", "Queued");
  return status;
}

function describeDraftSchedule(draft: CronEditDraft, agents: Array<{ id: string; name?: string }>, t: (key: string) => string): string {
  const selectedAgent = agents.find((agent) => agent.id === draft.agentId);
  const actor = selectedAgent?.name || selectedAgent?.id || tt(t, "cron.defaultAgent", "default agent");
  const task = draft.name.trim() || tt(t, "cron.unnamedTask", "this task");
  if (draft.scheduleKind === "every") {
    const minutes = Number(draft.everyMinutes);
    const interval = Number.isFinite(minutes) && minutes > 0
      ? `${Math.round(minutes)} ${tt(t, "cron.minutes", "minutes")}`
      : tt(t, "cron.interval", "interval");
    return tt(t, "cron.preview.every", "Every {{interval}}, {{agent}} runs: {{task}}")
      .replace("{{interval}}", interval)
      .replace("{{agent}}", actor)
      .replace("{{task}}", task);
  }
  if (draft.scheduleKind === "at") {
    return tt(t, "cron.preview.at", "At {{time}}, {{agent}} runs: {{task}}")
      .replace("{{time}}", draft.atLocal || tt(t, "common.time", "time"))
      .replace("{{agent}}", actor)
      .replace("{{task}}", task);
  }
  const label = draft.cronExpr.trim() === "0 9 * * 1"
    ? tt(t, "cron.simple.weekly", "Weekly")
    : draft.cronExpr.trim() === "0 9 * * *"
      ? tt(t, "cron.simple.daily", "Daily")
      : draft.cronExpr.trim();
  return tt(t, "cron.preview.cron", "{{schedule}}, {{agent}} runs: {{task}}")
    .replace("{{schedule}}", label || tt(t, "cron.schedule", "Schedule"))
    .replace("{{agent}}", actor)
    .replace("{{task}}", task);
}

function CronJobCard({
  job,
  preview,
  runNotice,
  busy,
  onToggleRuns,
  onOpenSessionKey,
  onRun,
  onEdit,
  onToggleEnabled,
  onDelete,
  t,
}: {
  job: CronJobRow;
  preview?: { label?: string; detail?: string };
  runNotice?: CronRunNotice;
  busy: boolean;
  onToggleRuns: () => void;
  onOpenSessionKey: (sessionKey: string) => void;
  onRun: () => void;
  onEdit: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
  t: (key: string) => string;
}) {
  const scheduleText = formatCronSchedule(job.schedule, t);
  const delivery = describeCronDeliveryLine(job, preview ?? null, t);
  const title = job.name?.trim() || job.id;
  const lastRunText = formatCronTimestamp(job.state?.lastRunAtMs);
  const lastRunStatus = job.state?.lastRunStatus;
  const sendMode = resolveCronSendMode(job);
  const sendText = describeCronSendMode(job, delivery.text, t);

  return (
    <article className={`info-card cron-job-card ${job.enabled === false ? "cron-job-disabled" : ""}`}>
      <div className="cron-job-head">
        <div>
          <strong>{title}</strong>
          <div className="cron-job-meta">
            <code>{job.id}</code>
            {job.agentId ? <span>{tt(t, "common.agent", "Agent")} · {job.agentId}</span> : null}
          </div>
        </div>
        <div className="cron-job-badges">
          {job.enabled === false ? <span className="toggle-badge disabled">{tt(t, "common.disabled", "Disabled")}</span> : null}
          {sendMode === "silent" || sendMode === "isolated" ? (
            <span className="cron-badge cron-badge-none" title={tt(t, "cron.noDeliverySummary", "No channel delivery summary, execute only")}>
              {sendMode === "isolated" ? tt(t, "cron.badge.isolated", "Isolated") : tt(t, "cron.badge.silent", "Silent")}
            </span>
          ) : (
            <span className="cron-badge cron-badge-deliver">{sendMode === "webhook" ? tt(t, "cron.badge.webhook", "Webhook") : tt(t, "cron.badge.notify", "Notify")}</span>
          )}
        </div>
      </div>
      <div className="cron-job-schedule">
        <span>{tt(t, "cron.schedule", "Schedule")}</span>
        <code>{scheduleText}</code>
      </div>
      <div className="cron-job-delivery-line">
        <span>{tt(t, "cron.delivery", "Delivery")}</span>
        <span>{sendText}</span>
      </div>
      <div className="cron-job-last-run">
        <span>{tt(t, "cron.lastRun", "Last run")}</span>
        <span title={lastRunText}>
          {lastRunText}
          {lastRunStatus ? <em className={`cron-last-status cron-last-status-${lastRunStatus}`}>{cronStatusLabel(lastRunStatus, t)}</em> : null}
        </span>
      </div>
      {job.sessionKey ? (
        <div className="cron-job-session">
          <span>{tt(t, "cron.boundSession", "Bound session")}</span>
          <button type="button" className="ghost-link-button" onClick={() => onOpenSessionKey(job.sessionKey!)}>
            {tt(t, "conversation.openSession", "Open session")}
          </button>
        </div>
      ) : null}
      <div className="cron-job-actions">
        <button type="button" className="ghost-link-button primary-action" onClick={onRun} disabled={busy}>
          {busy ? tt(t, "cron.running", "Running") : tt(t, "cron.run", "Run")}
        </button>
        <button type="button" className="ghost-link-button" onClick={onToggleRuns}>
          {tt(t, "cron.runs", "Runs")}
        </button>
        <button type="button" className="ghost-link-button" onClick={onEdit} disabled={busy}>{tt(t, "common.edit", "Edit")}</button>
        <button type="button" className="ghost-link-button" onClick={onToggleEnabled} disabled={busy}>
          {job.enabled === false ? tt(t, "common.enable", "Enable") : tt(t, "common.disable", "Disable")}
        </button>
        <button type="button" className="ghost-link-button danger-action" onClick={onDelete} disabled={busy}>{tt(t, "common.delete", "Delete")}</button>
      </div>
      {runNotice ? (
        <div className={`cron-run-notice cron-run-notice-${runNotice.status}`}>
          <span>{describeRunNotice(runNotice, t)}</span>
          {runNotice.runId ? <code>{runNotice.runId}</code> : null}
        </div>
      ) : null}
    </article>
  );
}

function CronRunsDialog({
  job,
  runs,
  runsLoading,
  onClose,
  onOpenSessionKey,
  t,
}: {
  job: CronJobRow;
  runs: CronRunRow[] | undefined;
  runsLoading: boolean;
  onClose: () => void;
  onOpenSessionKey: (sessionKey: string) => void;
  t: (key: string) => string;
}) {
  const title = job.name?.trim() || job.id;
  return (
    <div className="cron-runs-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="cron-runs-modal" onClick={(event) => event.stopPropagation()}>
        <div className="cron-runs-modal-head">
          <div>
            <strong>{tt(t, "cron.runs", "Runs")}</strong>
            <span>{title}</span>
          </div>
          <button type="button" onClick={onClose} aria-label={tt(t, "common.close", "Close")} title={tt(t, "common.close", "Close")}>×</button>
        </div>
        <div className="cron-runs-modal-body">
          {runsLoading ? <div className="inline-page-status">{tt(t, "cron.loadingRuns", "Loading runs...")}</div> : null}
          {!runsLoading && runs && runs.length === 0 ? <div className="empty-panel">{tt(t, "cron.emptyRuns", "No run records yet.")}</div> : null}
          {!runsLoading && runs && runs.length > 0 ? (
            <div className="cron-runs-list">
              {runs.map((row, idx) => (
                <div className="cron-run-row" key={`${row.ts}-${idx}`}>
                  <span className="cron-run-time">{formatRunTs(row.ts)}</span>
                  <span className={`cron-run-status cron-run-status-${row.status ?? "unknown"}`}>{cronStatusLabel(row.status, t)}</span>
                  <span className="cron-run-summary">{row.summary || row.jobId || tt(t, "cron.noSummary", "No summary")}</span>
                  {row.sessionKey ? (
                    <button
                      type="button"
                      className="ghost-link-button"
                      onClick={() => {
                        onClose();
                        onOpenSessionKey(row.sessionKey!);
                      }}
                    >
                      {tt(t, "conversation.openSession", "Open session")}
                    </button>
                  ) : (
                    <span className="cron-run-no-session">{tt(t, "cron.noSession", "No session")}</span>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="cron-runs-modal-actions">
          <button type="button" className="ghost-link-button" onClick={onClose}>{tt(t, "common.close", "Close")}</button>
        </div>
      </div>
    </div>
  );
}

function CronEditDialog({
  draft,
  busy,
  onChange,
  onCancel,
  onSubmit,
  agents,
  t,
}: {
  draft: CronEditDraft;
  busy: boolean;
  onChange: (draft: CronEditDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
  agents: Array<{ id: string; name?: string }>;
  t: (key: string) => string;
}) {
  const [createStep, setCreateStep] = useState<1 | 2 | 3>(1);
  useEffect(() => {
    setCreateStep(1);
  }, [draft.id]);
  const patch = <K extends keyof CronEditDraft>(key: K, value: CronEditDraft[K]) => {
    onChange({ ...draft, [key]: value });
  };
  const applyTemplate = (templateId: string) => {
    const template = CRON_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    onChange({
      ...draft,
      name: tt(t, template.nameKey, ""),
      description: tt(t, template.summaryKey, ""),
      payloadText: tt(t, template.payloadKey, ""),
      scheduleKind: template.scheduleKind,
      cronExpr: template.cronExpr ?? draft.cronExpr,
      everyMinutes: template.everyMinutes ?? draft.everyMinutes,
      atLocal: draft.atLocal || defaultAtLocalValue(),
      sendMode: "notify",
    });
  };
  const chooseSchedule = (kind: "daily" | "weekly" | "every" | "at") => {
    if (kind === "daily") {
      onChange({ ...draft, scheduleKind: "cron", cronExpr: "0 9 * * *", cronTz: draft.cronTz || "Asia/Shanghai" });
      return;
    }
    if (kind === "weekly") {
      onChange({ ...draft, scheduleKind: "cron", cronExpr: "0 9 * * 1", cronTz: draft.cronTz || "Asia/Shanghai" });
      return;
    }
    if (kind === "every") {
      onChange({ ...draft, scheduleKind: "every", everyMinutes: draft.everyMinutes || "60" });
      return;
    }
    onChange({ ...draft, scheduleKind: "at", atLocal: draft.atLocal || defaultAtLocalValue() });
  };
  const schedulePreview = describeDraftSchedule(draft, agents, t);
  const isCreate = !draft.id;
  const showStep = (step: 1 | 2 | 3) => !isCreate || createStep === step;
  const canGoNextFromStep1 = draft.name.trim().length > 0 && draft.payloadText.trim().length > 0;

  return (
    <div className="cron-edit-backdrop" role="dialog" aria-modal="true">
      <form
        className="cron-edit-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="cron-edit-head">
          <div>
            <strong>{draft.id ? tt(t, "cron.editTitle", "Edit cron job") : tt(t, "cron.createTitle", "Create cron job")}</strong>
            <span>{draft.id ?? tt(t, "cron.newJob", "New job")}</span>
          </div>
          <button type="button" onClick={onCancel} aria-label={tt(t, "common.close", "Close")} title={tt(t, "common.close", "Close")}>×</button>
        </div>

        {isCreate ? (
          <div className="cron-step-tabs" aria-label={tt(t, "cron.steps", "Task creation steps")}>
            {[1, 2, 3].map((step) => (
              <button
                key={step}
                className={createStep === step ? "active" : ""}
                type="button"
                onClick={() => setCreateStep(step as 1 | 2 | 3)}
              >
                <span>{step}</span>
                {step === 1 ? tt(t, "cron.step.short.what", "Task") : step === 2 ? tt(t, "cron.step.short.when", "Schedule") : tt(t, "cron.step.short.confirm", "Confirm")}
              </button>
            ))}
          </div>
        ) : null}

        <div className="cron-edit-body">
          {showStep(1) ? (
            <div className="cron-step-pane">
              {!draft.id ? (
                <section className="cron-template-panel" aria-labelledby="cron-template-title">
                  <div className="cron-template-head">
                    <strong id="cron-template-title">{tt(t, "cron.templates.title", "Common task templates")}</strong>
                    <span>{tt(t, "cron.templates.hint", "Pick one to fill the task, then edit it.")}</span>
                  </div>
                  <div className="cron-template-grid">
                    {CRON_TEMPLATES.map((template) => (
                      <button key={template.id} className="cron-template-card" type="button" onClick={() => applyTemplate(template.id)}>
                        <span aria-hidden="true">{template.emoji}</span>
                        <strong>{tt(t, template.nameKey, "")}</strong>
                        <small>{tt(t, template.summaryKey, "")}</small>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <div className="cron-edit-step">
                <span>1</span>
                <strong>{tt(t, "cron.step.what", "What should this task do?")}</strong>
              </div>
              <label>
                <span>{tt(t, "cron.taskName", "Task name")}</span>
                <input value={draft.name} onChange={(event) => patch("name", event.target.value)} placeholder={tt(t, "cron.taskNamePlaceholder", "e.g. Daily email check")} />
              </label>
              <label>
                <span>{tt(t, "common.description", "Description")}</span>
                <input value={draft.description} onChange={(event) => patch("description", event.target.value)} />
              </label>
              <label>
                <span>{tt(t, "cron.payload", "What should AI do?")}</span>
                <textarea value={draft.payloadText} onChange={(event) => patch("payloadText", event.target.value)} placeholder={tt(t, "cron.payloadPlaceholder", "Tell AI what to do, like: Check whether there are important emails today and summarize them for me.")} rows={5} />
              </label>
            </div>
          ) : null}

          {showStep(2) ? (
            <div className="cron-step-pane">
              <label>
                <span>{tt(t, "cron.agent", "Who should do it?")}</span>
                <select value={draft.agentId} onChange={(event) => patch("agentId", event.target.value)}>
                  <option value="">{tt(t, "cron.useDefaultAgent", "Use default agent")}</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>
                  ))}
                </select>
                <small>{tt(t, "cron.agentHint", "Not sure? Keep the default.")}</small>
              </label>
              <div className="cron-edit-step">
                <span>2</span>
                <strong>{tt(t, "cron.step.when", "When should it run?")}</strong>
              </div>
              <div className="cron-schedule-cards">
                <button className={draft.scheduleKind === "cron" && draft.cronExpr === "0 9 * * *" ? "active" : ""} type="button" onClick={() => chooseSchedule("daily")}>
                  <strong>{tt(t, "cron.simple.daily", "Daily")}</strong>
                  <small>{tt(t, "cron.simple.dailyHint", "Run once every day")}</small>
                </button>
                <button className={draft.scheduleKind === "cron" && draft.cronExpr === "0 9 * * 1" ? "active" : ""} type="button" onClick={() => chooseSchedule("weekly")}>
                  <strong>{tt(t, "cron.simple.weekly", "Weekly")}</strong>
                  <small>{tt(t, "cron.simple.weeklyHint", "Run every Monday")}</small>
                </button>
                <button className={draft.scheduleKind === "every" ? "active" : ""} type="button" onClick={() => chooseSchedule("every")}>
                  <strong>{tt(t, "cron.simple.every", "Every few hours")}</strong>
                  <small>{tt(t, "cron.simple.everyHint", "Repeat at a fixed interval")}</small>
                </button>
                <button className={draft.scheduleKind === "at" ? "active" : ""} type="button" onClick={() => chooseSchedule("at")}>
                  <strong>{tt(t, "cron.simple.once", "Specific time")}</strong>
                  <small>{tt(t, "cron.simple.onceHint", "Run once at a chosen time")}</small>
                </button>
              </div>
              {draft.scheduleKind === "every" ? (
                <label>
                  <span>{tt(t, "cron.intervalMinutes", "Interval minutes")}</span>
                  <input type="number" min="1" value={draft.everyMinutes} onChange={(event) => patch("everyMinutes", event.target.value)} />
                </label>
              ) : null}
              {draft.scheduleKind === "at" ? (
                <label>
                  <span>{tt(t, "common.time", "Time")}</span>
                  <input type="datetime-local" value={draft.atLocal} onChange={(event) => patch("atLocal", event.target.value)} />
                </label>
              ) : null}
            </div>
          ) : null}

          {showStep(3) ? (
            <div className="cron-step-pane">
              <div className="cron-edit-step">
                <span>3</span>
                <strong>{tt(t, "cron.step.confirm", "Confirm and create")}</strong>
              </div>
              <div className="cron-preview-line">
                {tt(t, "cron.previewPrefix", "Preview")}: {schedulePreview}
              </div>
              <details className="cron-edit-section">
                <summary>{tt(t, "cron.advanced", "Advanced options")}</summary>
                <label className="cron-edit-checkbox">
                  <input type="checkbox" checked={draft.enabled} onChange={(event) => patch("enabled", event.target.checked)} />
                  <span>{tt(t, "cron.enableJob", "Enable job")}</span>
                </label>
                <label>
                  <span>{tt(t, "common.type", "Type")}</span>
                  <select value={draft.scheduleKind} onChange={(event) => patch("scheduleKind", event.target.value as CronEditDraft["scheduleKind"])}>
                    <option value="cron">{tt(t, "cron.type.cron", "Cron expression")}</option>
                    <option value="every">{tt(t, "cron.type.every", "Fixed interval")}</option>
                    <option value="at">{tt(t, "cron.type.at", "Specific time")}</option>
                  </select>
                </label>
                {draft.scheduleKind === "cron" ? (
                  <>
                    <label>
                      <span>{tt(t, "cron.expression", "Cron expression")}</span>
                      <input value={draft.cronExpr} onChange={(event) => patch("cronExpr", event.target.value)} placeholder="0 9 * * *" />
                    </label>
                    <label>
                      <span>{tt(t, "common.timezone", "Timezone")}</span>
                      <input value={draft.cronTz} onChange={(event) => patch("cronTz", event.target.value)} placeholder="Asia/Shanghai" />
                    </label>
                  </>
                ) : null}
                {draft.scheduleKind === "every" ? (
                  <label>
                    <span>{tt(t, "cron.intervalMinutes", "Interval minutes")}</span>
                    <input type="number" min="1" value={draft.everyMinutes} onChange={(event) => patch("everyMinutes", event.target.value)} />
                  </label>
                ) : null}
                {draft.scheduleKind === "at" ? (
                  <label>
                    <span>{tt(t, "common.time", "Time")}</span>
                    <input type="datetime-local" value={draft.atLocal} onChange={(event) => patch("atLocal", event.target.value)} />
                  </label>
                ) : null}
              </details>

              <details className="cron-edit-section">
                <summary>{tt(t, "cron.deliveryAdvanced", "Result delivery")}</summary>
                <label>
                  <span>{tt(t, "cron.resultDelivery", "Result delivery")}</span>
                  <select value={draft.sendMode} onChange={(event) => patch("sendMode", event.target.value as CronEditDraft["sendMode"])}>
                    <option value="notify">{tt(t, "cron.sendOption.notify", "Notify: send result to chat")}</option>
                    <option value="silent">{tt(t, "cron.sendOption.silent", "Silent: no runtime notification")}</option>
                    <option value="isolated">{tt(t, "cron.sendOption.isolated", "Isolated session: run in own session")}</option>
                    <option value="webhook">{tt(t, "cron.sendOption.webhook", "Webhook: send to URL")}</option>
                  </select>
                </label>
                {draft.sendMode === "notify" ? (
                  <>
                    <label>
                      <span>{tt(t, "common.channel", "Channel")}</span>
                      <input value={draft.deliveryChannel} onChange={(event) => patch("deliveryChannel", event.target.value)} placeholder={tt(t, "cron.deliveryChannelPlaceholder", "last / telegram / slack")} />
                    </label>
                    <label>
                      <span>{tt(t, "common.target", "Target")}</span>
                      <input value={draft.deliveryTo} onChange={(event) => patch("deliveryTo", event.target.value)} placeholder={tt(t, "cron.targetPlaceholder", "Leave empty to use default context")} />
                    </label>
                  </>
                ) : null}
                {draft.sendMode === "webhook" ? (
                  <label>
                    <span>{tt(t, "cron.webhookUrl", "Webhook URL")}</span>
                    <input value={draft.deliveryTo} onChange={(event) => patch("deliveryTo", event.target.value)} placeholder="https://example.com/hook" />
                  </label>
                ) : null}
              </details>
            </div>
          ) : null}
        </div>

        <div className="cron-edit-actions">
          <button className="ghost-link-button" type="button" onClick={isCreate && createStep > 1 ? () => setCreateStep((current) => (current === 3 ? 2 : 1)) : onCancel}>
            {isCreate && createStep > 1 ? tt(t, "common.back", "Back") : tt(t, "common.cancel", "Cancel")}
          </button>
          {isCreate && createStep < 3 ? (
            <button
              className="ghost-link-button primary-action"
              type="button"
              disabled={createStep === 1 && !canGoNextFromStep1}
              onClick={() => setCreateStep((current) => (current === 1 ? 2 : 3))}
            >
              {tt(t, "common.next", "Next")}
            </button>
          ) : (
            <button className="ghost-link-button primary-action" type="submit" disabled={busy}>{busy ? tt(t, "common.saving", "Saving") : tt(t, "common.save", "Save")}</button>
          )}
        </div>
      </form>
    </div>
  );
}
