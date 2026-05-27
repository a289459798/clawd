export type ConversationFiltersPersistence = {
  search: string;
  runtimeFilter: string;
  sort: "updated" | "tokens" | "status";
};

const DEFAULT_FILTERS: ConversationFiltersPersistence = {
  search: "",
  runtimeFilter: "all",
  sort: "updated",
};

export function parseConversationFilters(raw: string | null): ConversationFiltersPersistence {
  if (!raw) return DEFAULT_FILTERS;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      search: typeof parsed.search === "string" ? parsed.search : "",
      runtimeFilter: typeof parsed.runtimeFilter === "string" && parsed.runtimeFilter ? parsed.runtimeFilter : "all",
      sort: parsed.sort === "tokens" || parsed.sort === "status" ? parsed.sort : "updated",
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function serializeConversationFilters(filters: ConversationFiltersPersistence) {
  return JSON.stringify(filters);
}
