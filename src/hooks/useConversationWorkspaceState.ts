import { useDeferredValue, useMemo } from "react";
import { findConversationById, getVisibleConversations } from "../lib/conversationSelectors";
import type { Agent } from "../types/app";
import type { Conversation } from "../types/conversation";

const RECENT_CONVERSATION_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

type ConversationSort = "updated" | "tokens" | "status";

export function useConversationWorkspaceState({
  agents,
  activeConversationId,
  expandedConversationId,
  openedConversationIds,
  conversationSearch,
  conversationRuntimeFilter,
  conversationSort,
}: {
  agents: Agent[];
  activeConversationId: string | null;
  expandedConversationId: string;
  openedConversationIds: Record<string, true>;
  conversationSearch: string;
  conversationRuntimeFilter: string;
  conversationSort: ConversationSort;
}) {
  const visibleConversations = useMemo(() => getVisibleConversations(agents), [agents]);
  const deferredConversationSearch = useDeferredValue(conversationSearch);

  const conversationRuntimeOptions = useMemo(() => {
    const runtimeById = new Map<string, { value: string; label: string; count: number }>();
    for (const conversation of visibleConversations) {
      const runtime = conversation.agentRuntime;
      if (!runtime?.id) continue;
      const existing = runtimeById.get(runtime.id);
      if (existing) {
        existing.count += 1;
      } else {
        runtimeById.set(runtime.id, {
          value: runtime.id,
          label: runtime.label ?? runtime.id,
          count: 1,
        });
      }
    }
    return [...runtimeById.values()].sort((left, right) => left.label.localeCompare(right.label));
  }, [visibleConversations]);

  const conversationFiltersActive = Boolean(conversationSearch.trim()) || conversationRuntimeFilter !== "all";
  const selectedConversationIds = useMemo(
    () => new Set([activeConversationId, expandedConversationId].filter(Boolean)),
    [activeConversationId, expandedConversationId],
  );

  const recentVisibleConversations = useMemo(() => {
    const now = Date.now();
    return visibleConversations.filter((conversation) => {
      if (selectedConversationIds.has(conversation.id) || openedConversationIds[conversation.id]) {
        return true;
      }
      if (conversation.isDraft || conversation.status === "working") {
        return true;
      }
      return typeof conversation.updatedAt === "number" && now - conversation.updatedAt <= RECENT_CONVERSATION_WINDOW_MS;
    });
  }, [openedConversationIds, selectedConversationIds, visibleConversations]);

  const runtimeFilteredVisibleConversations = useMemo(
    () => conversationRuntimeFilter === "all"
      ? recentVisibleConversations
      : recentVisibleConversations.filter((conversation) => conversation.agentRuntime?.id === conversationRuntimeFilter),
    [conversationRuntimeFilter, recentVisibleConversations],
  );

  const searchFilteredVisibleConversations = useMemo(() => {
    const query = deferredConversationSearch.trim().toLowerCase();
    if (!query) return runtimeFilteredVisibleConversations;
    return runtimeFilteredVisibleConversations.filter((conversation) =>
      [
        conversation.title,
        conversation.id,
        conversation.agentName,
        conversation.channel,
        conversation.lastMessage,
        conversation.model,
        conversation.agentRuntime?.id,
        conversation.agentRuntime?.label,
        conversation.agentRuntime?.source,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [deferredConversationSearch, runtimeFilteredVisibleConversations]);

  const filteredVisibleConversations = useMemo(() => {
    return [...searchFilteredVisibleConversations].sort((left, right) => {
      if (conversationSort === "tokens") {
        return (right.totalTokens ?? 0) - (left.totalTokens ?? 0);
      }
      if (conversationSort === "status") {
        const statusRank: Record<Conversation["status"], number> = { working: 0, failed: 1, stopped: 2, completed: 3, idle: 4 };
        const byStatus = statusRank[left.status] - statusRank[right.status];
        if (byStatus !== 0) return byStatus;
      }
      return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
    });
  }, [conversationSort, searchFilteredVisibleConversations]);

  const activeConversation = useMemo(
    () => findConversationById(agents, activeConversationId),
    [activeConversationId, agents],
  );

  return {
    visibleConversations,
    conversationRuntimeOptions,
    conversationFiltersActive,
    filteredVisibleConversations,
    activeConversation,
  };
}
