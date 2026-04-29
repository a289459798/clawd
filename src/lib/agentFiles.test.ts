import { describe, expect, it } from "vitest";
import { orderAgentFiles } from "./agentFiles";

describe("orderAgentFiles", () => {
  it("orders OpenClaw workspace files by setup importance", () => {
    const files = [
      { name: "USER.md", path: "/tmp/USER.md", missing: false },
      { name: "TOOLS.md", path: "/tmp/TOOLS.md", missing: false },
      { name: "IDENTITY.md", path: "/tmp/IDENTITY.md", missing: false },
      { name: "AGENTS.md", path: "/tmp/AGENTS.md", missing: false },
      { name: "MEMORY.md", path: "/tmp/MEMORY.md", missing: true },
      { name: "SOUL.md", path: "/tmp/SOUL.md", missing: false },
    ];

    expect(orderAgentFiles(files).map((file) => file.name)).toEqual([
      "AGENTS.md",
      "IDENTITY.md",
      "SOUL.md",
      "USER.md",
      "TOOLS.md",
      "MEMORY.md",
    ]);
  });
});
