import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { OpenClawSnapshot } from "../types/gateway";
import type { Agent, Skill, ChannelConnection } from "../types/app";
import { buildAgentsFromSnapshot } from "../lib/agentsSnapshot";

interface UseGatewayRealtimeProps {
  enabled: boolean;
  agents: Agent[];
  onAgentsChange: (updater: (current: Agent[]) => Agent[]) => void;
  onSkillsChange: (skills: Skill[]) => void;
  onConnectionsChange: (connections: ChannelConnection[]) => void;
}

export function useGatewayRealtime({
  enabled,
  agents,
  onAgentsChange,
  onSkillsChange,
  onConnectionsChange,
}: UseGatewayRealtimeProps) {
  const agentsRef = useRef(agents);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const loadSnapshot = async () => {
      try {
        const currentAgentSnapshots = agentsRef.current;
        const snapshot = await invoke<OpenClawSnapshot>("load_openclaw_snapshot");
        if (cancelled) return;

        // Skip updating if there's an active run in progress
        const hasActiveRun = currentAgentSnapshots.some((agent) =>
          agent.conversations.some((conv) => conv.runtime?.activeRunId),
        );
        if (hasActiveRun) return;

        onAgentsChange(() => buildAgentsFromSnapshot(snapshot, currentAgentSnapshots, { preserveExistingConversations: true }));

        onSkillsChange(
          snapshot.skills.map((skill) => ({
            id: skill.id,
            name: skill.name,
            summary: "Loaded from local OpenClaw skill directory.",
            enabled: true,
          })),
        );

        onConnectionsChange(
          snapshot.connections.map((connection) => ({
            id: connection.id,
            name: connection.name,
            status: connection.enabled ? "connected" : "disabled",
            detail: connection.enabled ? "Loaded from local OpenClaw config" : "Currently disabled",
            config: `channels.${connection.id}`,
            activity: connection.enabled ? "Configuration enabled" : "Configuration disabled",
          })),
        );
      } catch (error) {
        console.error("Failed to load OpenClaw snapshot", error);
      }
    };

    void loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, [enabled, onAgentsChange, onSkillsChange, onConnectionsChange]);
}
