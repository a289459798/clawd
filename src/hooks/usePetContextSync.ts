import { emit } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";
import { findConversationById } from "../lib/conversationSelectors";
import { buildPetContext, normalizePetTimestamp } from "../lib/appDerivedData";
import type { Agent } from "../types/app";
import type { Conversation } from "../types/conversation";

export function usePetContextSync({
  agents,
  activeConversation,
  activeConversationId,
  activeNav,
  agentsRef,
  activeConversationIdRef,
  petContextSnapshotRef,
}: {
  agents: Agent[];
  activeConversation: Conversation | null;
  activeConversationId: string | null;
  activeNav: string;
  agentsRef: { current: Agent[] };
  activeConversationIdRef: { current: string | null };
  petContextSnapshotRef: { current: string };
}) {
  const [petClock, setPetClock] = useState(() => Date.now());
  const hasTimedPetReplies = useMemo(
    () => agents.some((agent) =>
      agent.conversations.some((conversation) =>
        conversation.status === "completed"
          && typeof normalizePetTimestamp(conversation.runtime?.lastTerminalAt ?? conversation.updatedAt) === "number")),
    [agents],
  );

  useEffect(() => {
    if (!hasTimedPetReplies || activeNav !== "pets") return;
    const interval = window.setInterval(() => setPetClock(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [activeNav, hasTimedPetReplies]);

  const petContext = useMemo(
    () => buildPetContext(agents, activeConversation, activeNav === "pets" ? petClock : Date.now()),
    [activeConversation, activeNav, agents, petClock],
  );

  useEffect(() => {
    const emitPetContext = () => {
      const currentActiveConversation = findConversationById(agentsRef.current, activeConversationIdRef.current);
      const nextContext = buildPetContext(agentsRef.current, currentActiveConversation, Date.now());
      const serialized = JSON.stringify(nextContext);
      if (serialized === petContextSnapshotRef.current) return;
      petContextSnapshotRef.current = serialized;
      localStorage.setItem("clawkit.petContext", serialized);
      void emit("clawkit://pet-context", nextContext);
    };

    emitPetContext();
    if (!hasTimedPetReplies) return;
    const interval = window.setInterval(emitPetContext, 1_000);
    return () => window.clearInterval(interval);
  }, [activeConversationId, agents, hasTimedPetReplies, activeConversationIdRef, agentsRef, petContextSnapshotRef]);

  return { petContext };
}
