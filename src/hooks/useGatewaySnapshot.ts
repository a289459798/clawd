import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { buildSnapshotFromGateway } from "../lib/gatewaySnapshotAdapter";
import type { GatewayAgentsListResult, GatewaySessionsListResult, OpenClawSnapshot } from "../types/gateway";

type LoadGatewaySnapshotOptions = {
  fallbackSnapshot?: OpenClawSnapshot | null;
};

export function useGatewaySnapshot() {
  const loadGatewaySnapshot = useCallback(async (options?: LoadGatewaySnapshotOptions) => {
    await invoke("gateway_connect");

    const [agentsResult, sessionsResult] = await Promise.all([
      invoke<GatewayAgentsListResult>("gateway_agents_list"),
      invoke<GatewaySessionsListResult>("gateway_sessions_list", {
        params: {
          limit: 50,
          configuredAgentsOnly: true,
          includeDerivedTitles: false,
          includeLastMessage: false,
          includeGlobal: false,
          includeUnknown: false,
        },
      }),
    ]);

    const snapshot = buildSnapshotFromGateway({
      agentsResult,
      sessionsResult,
      previewsResult: null,
      fallbackSnapshot: options?.fallbackSnapshot,
    });
    return {
      snapshot,
      sessionsDefaults: sessionsResult.defaults,
      sessionsHasMore: sessionsResult.hasMore === true,
    };
  }, []);

  return { loadGatewaySnapshot };
}
