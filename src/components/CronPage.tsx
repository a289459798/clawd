import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  describeCronDeliveryLine,
  formatCronSchedule,
  formatCronTimestamp,
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

type CronPageProps = {
  gatewayConnected: boolean;
  /** Navigate to chat tab and focus session key */
  onOpenSessionKey: (sessionKey: string) => void;
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
};

function formatRunTs(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export function CronPage({ gatewayConnected, onOpenSessionKey }: CronPageProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listPayload, setListPayload] = useState<unknown>(null);
  const [expandedRunJobId, setExpandedRunJobId] = useState<string | null>(null);
  const [runsByJob, setRunsByJob] = useState<Record<string, CronRunRow[]>>({});
  const [runsLoadingJobId, setRunsLoadingJobId] = useState<string | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<CronEditDraft | null>(null);

  const parsed = useMemo(() => parseCronListPayload(listPayload), [listPayload]);
  const enabledCount = parsed.jobs.filter((job) => job.enabled !== false).length;
  const disabledCount = parsed.jobs.length - enabledCount;
  const deliveryCount = parsed.jobs.filter((job) => !describeCronDeliveryLine(job, parsed.deliveryPreviews[job.id] ?? null).noDelivery).length;

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
      setError(err instanceof Error ? err.message : "加载定时任务失败");
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
    if (!window.confirm(`删除定时任务「${title}」？此操作不可撤销。`)) return;
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
      await invoke<unknown>("gateway_cron_run", { params: { id: job.id, mode: "force" } });
      const rawRuns = await invoke<unknown>("gateway_cron_runs", {
        params: { id: job.id, limit: 25, sortDir: "desc" },
      });
      setRunsByJob((prev) => ({ ...prev, [job.id]: parseCronRunsPayload(rawRuns) }));
      setExpandedRunJobId(job.id);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyJobId(null);
    }
  };

  const openEdit = (job: CronJobRow) => {
    const sendMode = resolveCronSendMode(job);
    setEditDraft({
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
    });
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
      atLocal: "",
      sendMode: "notify",
      deliveryChannel: "",
      deliveryTo: "",
    });
  };

  const saveEditDraft = async (draft: CronEditDraft) => {
    const patch = buildCronPatchFromDraft(draft, !draft.id);
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
        <div className="empty-panel">请先连接 OpenClaw Gateway，才能读取 Gateway 侧的定时任务列表。</div>
      </section>
    );
  }

  return (
    <section className="single-page cron-page">
      <div className="cron-summary-grid">
        <div className="cron-summary-stat"><span>任务</span><strong>{parsed.total || parsed.jobs.length}</strong></div>
        <div className="cron-summary-stat"><span>启用</span><strong>{enabledCount}</strong></div>
        <div className="cron-summary-stat"><span>投递</span><strong>{deliveryCount}</strong></div>
        <div className="cron-summary-stat"><span>禁用</span><strong>{disabledCount}</strong></div>
      </div>

      <div className="cron-toolbar">
        <span />
        <button type="button" className="ghost-link-button" onClick={openCreate} disabled={loading || busyJobId !== null}>
          创建
        </button>
        <button type="button" className="ghost-link-button primary-action" onClick={() => void loadList()} disabled={loading}>
          {loading ? "刷新中" : "刷新"}
        </button>
      </div>

      {error ? <div className="inline-page-status cron-error">{error}</div> : null}
      {loading && !parsed.jobs.length ? <div className="inline-page-status">正在加载定时任务...</div> : null}

      {!loading && !error && parsed.jobs.length === 0 ? (
        <div className="empty-panel">当前筛选条件下没有定时任务。</div>
      ) : null}

      <div className="cron-job-list">
        {parsed.jobs.map((job) => (
          <CronJobCard
            key={job.id}
            job={job}
            preview={parsed.deliveryPreviews[job.id]}
            expanded={expandedRunJobId === job.id}
            runs={runsByJob[job.id]}
            runsLoading={runsLoadingJobId === job.id}
            busy={busyJobId === job.id}
            onToggleRuns={() => void toggleRuns(job.id)}
            onOpenSessionKey={onOpenSessionKey}
            onRun={() => void runJob(job)}
            onEdit={() => openEdit(job)}
            onToggleEnabled={() => void updateJob(job.id, { enabled: job.enabled === false })}
            onDelete={() => void removeJob(job)}
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
        />
      ) : null}
    </section>
  );
}

function buildCronPatchFromDraft(draft: CronEditDraft, requirePayload: boolean): Record<string, unknown> | null {
  const name = draft.name.trim();
  if (!name) {
    window.alert("任务名称不能为空。");
    return null;
  }
  const patch: Record<string, unknown> = {
    name,
    description: draft.description.trim(),
    enabled: draft.enabled,
  };
  const payloadText = draft.payloadText.trim();
  if (requirePayload && !payloadText) {
    window.alert("创建任务时需要填写任务内容。");
    return null;
  }
  if (draft.sendMode === "webhook" && !draft.deliveryTo.trim()) {
    window.alert("Webhook URL 不能为空。");
    return null;
  }
  Object.assign(patch, buildSendModePatch(draft, payloadText));

  if (draft.scheduleKind === "cron") {
    const expr = draft.cronExpr.trim();
    if (!expr) {
      window.alert("Cron 表达式不能为空。");
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
      window.alert("间隔分钟必须大于 0。");
      return null;
    }
    patch.schedule = { kind: "every", everyMs: Math.round(minutes * 60_000) };
  } else {
    if (!draft.atLocal) {
      window.alert("定时时间不能为空。");
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

function describeCronSendMode(job: CronJobRow, deliveryText: string): string {
  const mode = resolveCronSendMode(job);
  if (mode === "notify") return `通知我 · ${deliveryText}`;
  if (mode === "silent") return "静默 · 运行时不通知";
  if (mode === "isolated") return "独立会话 · 在自己的会话中运行";
  return "Webhook · 将结果发送到 URL";
}

function CronJobCard({
  job,
  preview,
  expanded,
  runs,
  runsLoading,
  busy,
  onToggleRuns,
  onOpenSessionKey,
  onRun,
  onEdit,
  onToggleEnabled,
  onDelete,
}: {
  job: CronJobRow;
  preview?: { label?: string; detail?: string };
  expanded: boolean;
  runs: CronRunRow[] | undefined;
  runsLoading: boolean;
  busy: boolean;
  onToggleRuns: () => void;
  onOpenSessionKey: (sessionKey: string) => void;
  onRun: () => void;
  onEdit: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
}) {
  const scheduleText = formatCronSchedule(job.schedule);
  const delivery = describeCronDeliveryLine(job, preview ?? null);
  const title = job.name?.trim() || job.id;
  const lastRunText = formatCronTimestamp(job.state?.lastRunAtMs);
  const lastRunStatus = job.state?.lastRunStatus;
  const sendMode = resolveCronSendMode(job);
  const sendText = describeCronSendMode(job, delivery.text);

  return (
    <article className={`info-card cron-job-card ${job.enabled === false ? "cron-job-disabled" : ""} ${expanded ? "cron-job-expanded" : ""}`}>
      <div className="cron-job-head">
        <div>
          <strong>{title}</strong>
          <div className="cron-job-meta">
            <code>{job.id}</code>
            {job.agentId ? <span>Agent · {job.agentId}</span> : null}
          </div>
        </div>
        <div className="cron-job-badges">
          {job.enabled === false ? <span className="toggle-badge disabled">已禁用</span> : null}
          {sendMode === "silent" || sendMode === "isolated" ? (
            <span className="cron-badge cron-badge-none" title="不在通道投递摘要，仅执行任务">
              {sendMode === "isolated" ? "独立" : "静默"}
            </span>
          ) : (
            <span className="cron-badge cron-badge-deliver">{sendMode === "webhook" ? "Webhook" : "通知"}</span>
          )}
        </div>
      </div>
      <div className="cron-job-schedule">
        <span>调度</span>
        <code>{scheduleText}</code>
      </div>
      <div className="cron-job-delivery-line">
        <span>发送</span>
        <span>{sendText}</span>
      </div>
      <div className="cron-job-last-run">
        <span>最后执行</span>
        <span title={lastRunText}>
          {lastRunText}
          {lastRunStatus ? <em className={`cron-last-status cron-last-status-${lastRunStatus}`}>{lastRunStatus}</em> : null}
        </span>
      </div>
      {job.sessionKey ? (
        <div className="cron-job-session">
          <span>绑定会话</span>
          <button type="button" className="ghost-link-button" onClick={() => onOpenSessionKey(job.sessionKey!)}>
            打开会话
          </button>
        </div>
      ) : null}
      <div className="cron-job-actions">
        <button type="button" className="ghost-link-button primary-action" onClick={onRun} disabled={busy}>
          {busy ? "运行中" : "运行"}
        </button>
        <button type="button" className="ghost-link-button" onClick={onToggleRuns} disabled={busy}>
          {expanded ? "隐藏运行记录" : "运行记录"}
        </button>
        <button type="button" className="ghost-link-button" onClick={onEdit} disabled={busy}>编辑</button>
        <button type="button" className="ghost-link-button" onClick={onToggleEnabled} disabled={busy}>
          {job.enabled === false ? "启用" : "停用"}
        </button>
        <button type="button" className="ghost-link-button danger-action" onClick={onDelete} disabled={busy}>删除</button>
      </div>
      {expanded ? (
        <div className="cron-runs-panel">
          {runsLoading ? <div className="inline-page-status">加载运行记录…</div> : null}
          {!runsLoading && runs && runs.length === 0 ? <div className="empty-panel">暂无运行记录。</div> : null}
          {!runsLoading && runs && runs.length > 0 ? (
            <div className="cron-runs-list">
              {runs.map((row, idx) => (
                <div className="cron-run-row" key={`${row.ts}-${idx}`}>
                  <span className="cron-run-time">{formatRunTs(row.ts)}</span>
                  <span className={`cron-run-status cron-run-status-${row.status ?? "unknown"}`}>{row.status ?? "-"}</span>
                  <span className="cron-run-summary">{row.summary || row.jobId || "无摘要"}</span>
                  {row.sessionKey ? (
                    <button
                      type="button"
                      className="ghost-link-button"
                      onClick={() => onOpenSessionKey(row.sessionKey!)}
                    >
                      打开会话
                    </button>
                  ) : (
                    <span className="cron-run-no-session">无会话</span>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function CronEditDialog({
  draft,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: CronEditDraft;
  busy: boolean;
  onChange: (draft: CronEditDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const patch = <K extends keyof CronEditDraft>(key: K, value: CronEditDraft[K]) => {
    onChange({ ...draft, [key]: value });
  };

  return (
    <div className="cron-edit-backdrop" role="dialog" aria-modal="true">
      <form
        className="cron-edit-drawer"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="cron-edit-head">
          <div>
            <strong>{draft.id ? "编辑定时任务" : "创建定时任务"}</strong>
            <span>{draft.id ?? "新建任务"}</span>
          </div>
          <button type="button" onClick={onCancel} aria-label="关闭" title="关闭">×</button>
        </div>

        <label>
          <span>名称</span>
          <input value={draft.name} onChange={(event) => patch("name", event.target.value)} />
        </label>
        <label>
          <span>说明</span>
          <input value={draft.description} onChange={(event) => patch("description", event.target.value)} />
        </label>
        <label>
          <span>任务内容</span>
          <input value={draft.payloadText} onChange={(event) => patch("payloadText", event.target.value)} placeholder="到时间后注入给 OpenClaw 的任务文本" />
        </label>
        <label className="cron-edit-checkbox">
          <input type="checkbox" checked={draft.enabled} onChange={(event) => patch("enabled", event.target.checked)} />
          <span>启用任务</span>
        </label>

        <div className="cron-edit-section">
          <strong>调度</strong>
          <label>
            <span>类型</span>
            <select value={draft.scheduleKind} onChange={(event) => patch("scheduleKind", event.target.value as CronEditDraft["scheduleKind"])}>
              <option value="cron">Cron 表达式</option>
              <option value="every">固定间隔</option>
              <option value="at">指定时间</option>
            </select>
          </label>
          {draft.scheduleKind === "cron" ? (
            <>
              <label>
                <span>Cron</span>
                <input value={draft.cronExpr} onChange={(event) => patch("cronExpr", event.target.value)} placeholder="0 9 * * *" />
              </label>
              <label>
                <span>时区</span>
                <input value={draft.cronTz} onChange={(event) => patch("cronTz", event.target.value)} placeholder="Asia/Shanghai" />
              </label>
            </>
          ) : null}
          {draft.scheduleKind === "every" ? (
            <label>
              <span>间隔分钟</span>
              <input type="number" min="1" value={draft.everyMinutes} onChange={(event) => patch("everyMinutes", event.target.value)} />
            </label>
          ) : null}
          {draft.scheduleKind === "at" ? (
            <label>
              <span>时间</span>
              <input type="datetime-local" value={draft.atLocal} onChange={(event) => patch("atLocal", event.target.value)} />
            </label>
          ) : null}
        </div>

        <div className="cron-edit-section">
          <strong>发送方式</strong>
          <label>
            <span>结果发送</span>
            <select value={draft.sendMode} onChange={(event) => patch("sendMode", event.target.value as CronEditDraft["sendMode"])}>
              <option value="notify">通知我：将结果发送到聊天</option>
              <option value="silent">静默：运行时不通知</option>
              <option value="isolated">独立会话：在自己的会话中运行</option>
              <option value="webhook">Webhook：发送到 URL</option>
            </select>
          </label>
          {draft.sendMode === "notify" ? (
            <>
              <label>
                <span>通道</span>
                <input value={draft.deliveryChannel} onChange={(event) => patch("deliveryChannel", event.target.value)} placeholder="last / telegram / slack" />
              </label>
              <label>
                <span>目标</span>
                <input value={draft.deliveryTo} onChange={(event) => patch("deliveryTo", event.target.value)} placeholder="可留空使用默认上下文" />
              </label>
            </>
          ) : null}
          {draft.sendMode === "webhook" ? (
            <label>
              <span>Webhook URL</span>
              <input value={draft.deliveryTo} onChange={(event) => patch("deliveryTo", event.target.value)} placeholder="https://example.com/hook" />
            </label>
          ) : null}
        </div>

        <div className="cron-edit-actions">
          <button className="ghost-link-button" type="button" onClick={onCancel}>取消</button>
          <button className="ghost-link-button primary-action" type="submit" disabled={busy}>{busy ? "保存中" : "保存"}</button>
        </div>
      </form>
    </div>
  );
}
