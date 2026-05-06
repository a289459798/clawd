import type { Conversation } from "../types/conversation";
import type { GatewaySessionsListResult } from "../types/gateway";

export type ThinkingOption = { value: string; label: string };

function gatewayDefaultsToThinkingOptions(defaults?: GatewaySessionsListResult["defaults"] | null): ThinkingOption[] {
  const levels = defaults?.thinkingLevels;
  if (!levels?.length) return [];
  return levels.map((level) => ({
    value: level.id,
    label: level.label?.trim() ? level.label.trim() : level.id,
  }));
}

/**
 * Composer thinking dropdown: prefer session row (`sessions.list` / snapshot),
 * fall back to Gateway `sessions.list` defaults thinkingLevels (provider/model policy).
 */
export function resolveComposerThinkingOptions(
  conversation: Conversation | null | undefined,
  sessionsDefaults?: GatewaySessionsListResult["defaults"] | null,
): ThinkingOption[] | undefined {
  const rowOptions = conversation?.thinkingOptions?.filter((option) => option.value?.trim());
  if (rowOptions && rowOptions.length > 0) {
    return rowOptions;
  }
  const fromDefaults = gatewayDefaultsToThinkingOptions(sessionsDefaults);
  return fromDefaults.length > 0 ? fromDefaults : undefined;
}
