import type { GatewayChannelsEventLoopHealth } from "../types/gateway";

/** Tooltip / badge detail — compact wording */
export function accountOperationalHealthHint(account: {
  running?: boolean;
  connected?: boolean;
  healthState?: string;
}): string | undefined {
  const hs = account.healthState?.trim();
  if (!hs || hs === "healthy") return undefined;
  const active = Boolean(account.running || account.connected);
  if (!active) return undefined;

  switch (hs) {
    case "stale-socket":
      return "传输层长时间无活动";
    case "stuck":
      return "任务疑似卡住";
    case "disconnected":
      return "未连上游";
    case "not-running":
      return "进程未运行";
    default:
      return describeHealthState(hs);
  }
}

export function resolveChannelOperationalDegraded(
  accounts: Array<{ running?: boolean; connected?: boolean; healthState?: string }>,
): boolean {
  return accounts.some((a) => accountOperationalHealthHint(a) !== undefined);
}

export function resolveChannelHealthHint(
  accounts: Array<{ running?: boolean; connected?: boolean; healthState?: string }>,
): string | undefined {
  for (const account of accounts) {
    const hint = accountOperationalHealthHint(account);
    if (hint) return hint;
  }
  return undefined;
}

export function describeHealthState(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) return code;

  const dictionary: Record<string, string> = {
    busy: "繁忙",
    unmanaged: "未托管",
    healthy: "健康",
    disconnected: "已断开",
    "not-running": "未运行",
    "stale-socket": "传输超时",
    stuck: "疑似卡住",
  };

  return dictionary[trimmed] ?? trimmed.replace(/-/g, " ");
}

export function formatGatewayEventLoopReason(reason: string): string {
  const key = reason.trim();
  const dictionary: Record<string, string> = {
    event_loop_delay: "事件循环延迟偏高，通道消息可能滞后",
    event_loop_utilization: "事件循环负载偏高",
    cpu: "CPU 占用偏高，可能影响实时性",
    memory: "内存压力偏高",
  };

  return dictionary[key] ?? describeHealthState(key.replace(/_/g, "-"));
}

export function formatGatewayEventLoopSummary(health: GatewayChannelsEventLoopHealth): string {
  const reasons = health.reasons?.filter((r) => Boolean(String(r).trim())) ?? [];
  const sentences = reasons.map((r) => formatGatewayEventLoopReason(String(r)));
  const merged = sentences.filter(Boolean);
  if (merged.length) {
    return merged.join("；");
  }
  return "Gateway 事件循环负载偏高，通道实时性可能下降";
}
