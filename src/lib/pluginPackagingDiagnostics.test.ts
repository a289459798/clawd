import { describe, expect, it } from "vitest";
import type { ChannelConnection } from "../types/app";
import {
  interpretPluginHealthError,
  mergePluginRepairsIntoConnections,
  parseHealthPluginErrors,
  pluginRepairMatchesChannel,
} from "./pluginPackagingDiagnostics";

describe("pluginPackagingDiagnostics", () => {
  it("parses plugins.errors from health payload", () => {
    const rows = parseHealthPluginErrors({
      ok: true,
      plugins: {
        errors: [
          {
            id: "discord",
            origin: "npm",
            activated: true,
            error: "Package @openclaw/discord requires compiled runtime output",
          },
        ],
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("discord");
  });

  it("classifies packaging errors and suggests reinstall", () => {
    const card = interpretPluginHealthError({
      id: "discord",
      origin: "npm",
      activated: true,
      error: "@openclaw/discord requires compiled runtime output for TypeScript entry",
    });
    expect(card.headlineZh).toContain("编译");
    expect(card.actions.some((a) => a.cli?.includes("plugins install"))).toBe(true);
    expect(card.actions.some((a) => a.cli?.includes("doctor"))).toBe(true);
  });

  it("matches channel ids with scoped plugin ids", () => {
    const card = interpretPluginHealthError({
      id: "@openclaw/discord",
      origin: "npm",
      activated: false,
      error: "failed",
    });
    expect(pluginRepairMatchesChannel(card, "discord")).toBe(true);
    expect(pluginRepairMatchesChannel(card, "slack")).toBe(false);
  });

  it("merges repairs into connections and keeps unmatched", () => {
    const cards = [
      interpretPluginHealthError({
        id: "discord",
        origin: "npm",
        activated: true,
        error: "compiled runtime output missing",
      }),
      interpretPluginHealthError({
        id: "memory-slot-x",
        origin: "npm",
        activated: true,
        error: "broken",
      }),
    ];
    const merged = mergePluginRepairsIntoConnections(
      [{ id: "discord" }, { id: "telegram" }] as ChannelConnection[],
      cards,
    );
    expect(merged.connections[0]?.pluginRepairs?.length).toBe(1);
    expect(merged.connections[1]?.pluginRepairs).toBeUndefined();
    expect(merged.unmatchedRepairs).toHaveLength(1);
    expect(merged.unmatchedRepairs[0]?.pluginId).toBe("memory-slot-x");
  });
});
