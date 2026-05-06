import { describe, expect, it } from "vitest";
import {
  buildChannelAccountReadiness,
  inferPluginContractIssueFromLastError,
  readinessHasSignals,
} from "./channelCredentialHints";

describe("channelCredentialHints", () => {
  it("flags configured_unavailable as SecretRef / resolution issue", () => {
    const r = buildChannelAccountReadiness({
      configured: true,
      botTokenStatus: "configured_unavailable",
      botTokenSource: "config",
    });
    expect(r.secretResolution.length).toBeGreaterThan(0);
    expect(r.secretResolution[0]).toContain("SecretRef");
    expect(readinessHasSignals(r)).toBe(true);
  });

  it("flags missing credentials when account configured", () => {
    const r = buildChannelAccountReadiness({
      configured: true,
      tokenStatus: "missing",
    });
    expect(r.credentialGaps.length).toBe(1);
  });

  it("detects plugin contract issues from lastError", () => {
    expect(
      inferPluginContractIssueFromLastError('Plugin missing channelConfigs for "demo"'),
    ).toContain("channelConfigs");
    expect(inferPluginContractIssueFromLastError("unsupported SecretRef surface")).toContain("SecretRef");
  });

  it("does not treat packaging diagnostics as contract when absent", () => {
    expect(inferPluginContractIssueFromLastError(undefined)).toBeUndefined();
  });
});
