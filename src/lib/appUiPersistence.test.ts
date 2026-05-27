import { describe, expect, it } from "vitest";
import { parseConversationFilters, serializeConversationFilters } from "./appUiPersistence";

describe("conversation filter persistence", () => {
  it("round trips valid filters", () => {
    const raw = serializeConversationFilters({ search: "openclaw", runtimeFilter: "codex", sort: "tokens" });
    expect(parseConversationFilters(raw)).toEqual({ search: "openclaw", runtimeFilter: "codex", sort: "tokens" });
  });

  it("falls back for invalid values", () => {
    expect(parseConversationFilters("{\"search\": 42, \"runtimeFilter\": \"\", \"sort\": \"bad\"}")).toEqual({
      search: "",
      runtimeFilter: "all",
      sort: "updated",
    });
  });
});
