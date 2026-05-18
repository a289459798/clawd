export type CronTemplate = {
  id: string;
  emoji: string;
  nameKey: string;
  summaryKey: string;
  payloadKey: string;
  scheduleKind: "cron" | "every" | "at";
  cronExpr?: string;
  everyMinutes?: string;
};

export const CRON_TEMPLATES: CronTemplate[] = [
  {
    id: "daily-review",
    emoji: "📅",
    nameKey: "cron.template.dailyReview.name",
    summaryKey: "cron.template.dailyReview.summary",
    payloadKey: "cron.template.dailyReview.payload",
    scheduleKind: "cron",
    cronExpr: "0 9 * * *",
  },
  {
    id: "handoff",
    emoji: "🌅",
    nameKey: "cron.template.handoff.name",
    summaryKey: "cron.template.handoff.summary",
    payloadKey: "cron.template.handoff.payload",
    scheduleKind: "cron",
    cronExpr: "0 18 * * *",
  },
  {
    id: "weekly-summary",
    emoji: "📊",
    nameKey: "cron.template.weeklySummary.name",
    summaryKey: "cron.template.weeklySummary.summary",
    payloadKey: "cron.template.weeklySummary.payload",
    scheduleKind: "cron",
    cronExpr: "0 9 * * 1",
  },
  {
    id: "follow-up",
    emoji: "🔁",
    nameKey: "cron.template.followUp.name",
    summaryKey: "cron.template.followUp.summary",
    payloadKey: "cron.template.followUp.payload",
    scheduleKind: "every",
    everyMinutes: "240",
  },
];
