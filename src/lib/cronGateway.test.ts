import { describe, expect, it } from "vitest";
import {
  describeCronDeliveryLine,
  formatCronSchedule,
  formatCronTimestamp,
  parseCronListPayload,
  parseCronRunsPayload,
  scheduleEveryMinutesOf,
  scheduleKindOf,
} from "./cronGateway";

const zh = (key: string) => ({
  "cron.schedule.everyHours": "每 {{count}} 小时",
  "cron.delivery.none": "不投递（仅执行任务）",
}[key] ?? key);

describe("formatCronSchedule", () => {
  it("formats cron expr", () => {
    expect(formatCronSchedule({ kind: "cron", expr: "0 * * * *", tz: "Asia/Shanghai" })).toBe(
      "0 * * * * (Asia/Shanghai)",
    );
  });

  it("formats everyMs", () => {
    expect(formatCronSchedule({ kind: "every", everyMs: 3600_000 }, zh)).toBe("每 1 小时");
  });
});

describe("describeCronDeliveryLine", () => {
  it("detects explicit none mode", () => {
    const r = describeCronDeliveryLine({ id: "1", delivery: { mode: "none" } }, null, zh);
    expect(r.noDelivery).toBe(true);
    expect(r.text).toContain("不投递");
  });

  it("maps preview not requested", () => {
    const r = describeCronDeliveryLine({ id: "1" }, { label: "not requested", detail: "not requested" });
    expect(r.noDelivery).toBe(true);
  });
});

describe("parseCronListPayload", () => {
  it("parses jobs and previews", () => {
    const parsed = parseCronListPayload({
      jobs: [{ id: "a", name: "Job", enabled: true, schedule: { kind: "cron", expr: "*" }, delivery: { mode: "none" }, state: { lastRunAtMs: 1000, lastRunStatus: "ok" } }],
      deliveryPreviews: { a: { label: "not requested", detail: "not requested" } },
      total: 1,
    });
    expect(parsed.jobs).toHaveLength(1);
    expect(parsed.jobs[0]?.id).toBe("a");
    expect(parsed.jobs[0]?.state?.lastRunAtMs).toBe(1000);
    expect(parsed.jobs[0]?.state?.lastRunStatus).toBe("ok");
    expect(parsed.deliveryPreviews.a?.label).toBe("not requested");
  });
});

describe("cron schedule helpers", () => {
  it("normalizes every minutes", () => {
    expect(scheduleKindOf({ kind: "every", everyMs: 120_000 })).toBe("every");
    expect(scheduleEveryMinutesOf({ kind: "every", everyMs: 120_000 })).toBe("2");
  });

  it("formats missing timestamps", () => {
    expect(formatCronTimestamp(undefined)).toBe("-");
  });
});

describe("parseCronRunsPayload", () => {
  it("parses entries", () => {
    const rows = parseCronRunsPayload({
      entries: [{ ts: 1000, status: "ok", sessionKey: "agent:main:main" }],
    });
    expect(rows[0]?.sessionKey).toBe("agent:main:main");
  });
});
