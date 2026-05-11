import type { GatewayChannelsStatusResult } from "../types/gateway";

/**
 * Gateway `channels.status` may list `channelOrder` separately from `channels` / `channelAccounts`.
 * Union all sources so dynamically loaded channels (e.g. qqbot) are not dropped when `channelOrder` omits them.
 */
export function resolveGatewayChannelStatusIds(result: GatewayChannelsStatusResult): string[] {
  const order = result.channelOrder ?? [];
  const keys = new Set([
    ...order,
    ...Object.keys(result.channels ?? {}),
    ...Object.keys(result.channelAccounts ?? {}),
  ]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of order) {
    const trimmed = typeof id === "string" ? id.trim() : "";
    if (!trimmed || seen.has(trimmed) || !keys.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  for (const id of [...keys].sort((a, b) => a.localeCompare(b))) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
