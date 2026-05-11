import { describe, expect, it } from "vitest";

import { getClawKitSelfUpdateView } from "./clawKitSelfUpdateState";

describe("getClawKitSelfUpdateView", () => {
  it("does not expose the update action while the artifact is still downloading", () => {
    expect(getClawKitSelfUpdateView({ status: "downloading", version: "0.2.0", mandatory: false })).toEqual({
      showOptionalUpdateChrome: false,
      mandatoryUpdateOpen: false,
      pendingVersion: "0.2.0",
      installingUpdate: false,
    });
  });

  it("exposes the update action only after a downloaded artifact is ready", () => {
    expect(
      getClawKitSelfUpdateView({
        status: "ready",
        update: { version: "0.2.0", mandatory: true, url: "https://example.com/app.tar.gz", path: "/tmp/app.tar.gz" },
      }),
    ).toEqual({
      showOptionalUpdateChrome: true,
      mandatoryUpdateOpen: true,
      pendingVersion: "0.2.0",
      installingUpdate: false,
    });
  });
});
