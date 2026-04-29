import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { buildSnapshotFromGateway } from "../lib/gatewaySnapshotAdapter";
import type {
  GatewayAgentsListResult,
  GatewaySessionsListResult,
  GatewaySessionsPreviewResult,
  OpenClawSnapshot,
} from "../types/gateway";

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
          limit: 100,
          includeDerivedTitles: true,
          includeLastMessage: true,
          includeGlobal: false,
          includeUnknown: false,
        },
      }),
    ]);

    const keys = (sessionsResult.sessions ?? []).map((session) => session.key).filter(Boolean).slice(0, 64);
    const previewsResult = keys.length
      ? await invoke<GatewaySessionsPreviewResult>("gateway_sessions_preview", {
          params: {
            keys,
            limit: 8,
            maxChars: 600,
          },
        })
      : null;

    return buildSnapshotFromGateway({
      agentsResult,
      sessionsResult,
      previewsResult,
      fallbackSnapshot: options?.fallbackSnapshot,
    });
  }, []);

  return { loadGatewaySnapshot };
}
