export const statusLabel = {
  working: "进行中",
  completed: "已完成",
  failed: "失败",
  stopped: "已停止",
  idle: "空闲中",
} as const;

export const connectionLabel = {
  connected: "已连接",
  degraded: "运行中（降级）",
  warning: "需检查",
  disabled: "未启用",
} as const;

export const formatTokenCount = (value?: number) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  if (value === 0) {
    return "0";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  }
  return String(value);
};
