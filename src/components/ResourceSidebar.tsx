import { useState, type CSSProperties } from "react";
import type { Agent } from "../types/app";
import type { Conversation } from "../types/conversation";
import { isSystemAutoConversation } from "../lib/conversationSelectors";
import { Icon, IconNames } from "./Icon";
type TranslateFn = (key: string) => string;
const tt = (t: TranslateFn, key: string, fallback: string) => {
  const value = t(key);
  return value === key ? fallback : value;
};

type ResourceSidebarProps = {
  agents: Agent[];
  expandedConversationId: string;
  onCreateAgent: () => void;
  onEditAgentFiles: (agentId: string) => void;
  onCreateConversation: (agentId: string) => void;
  onToggleConversationVisibility: (agentId: string, conversationId: string, visible: boolean) => void;
  onExpandedConversationChange: (conversationId: string) => void;
  onOpenConversation?: (conversationId: string) => void | Promise<void>;
  onCollapse: () => void;
  onExpand: () => void;
  visible: boolean;
  showSystemConversations: boolean;
  t: TranslateFn;
};

export function ResourceSidebar({
  agents,
  expandedConversationId,
  onCreateAgent,
  onEditAgentFiles,
  onCreateConversation,
  onToggleConversationVisibility,
  onExpandedConversationChange,
  onOpenConversation,
  onCollapse,
  onExpand,
  visible,
  showSystemConversations,
  t,
}: ResourceSidebarProps) {
  const [expandedAgentIds, setExpandedAgentIds] = useState<Set<string>>(() => new Set());
  const [collapsedAgentIds, setCollapsedAgentIds] = useState<Set<string>>(() => new Set());

  const renderConversationButton = (agentId: string, conversation: Conversation, depth = 0) => (
    <button
      className={`conversation-tree-item flat ${conversation.visible ? "visible" : "hidden"} ${expandedConversationId === conversation.id ? "selected" : ""} ${depth > 0 ? "child-session" : ""}`}
      key={conversation.id}
      onClick={() => {
        if (!conversation.visible) {
          onToggleConversationVisibility(agentId, conversation.id, true);
        }
        onExpandedConversationChange(conversation.id);
        onOpenConversation?.(conversation.id);
      }}
      type="button"
      style={depth > 0 ? { "--conversation-depth": depth } as CSSProperties : undefined}
    >
      <div className="conversation-title-wrap">
        <span className={`status-dot ${conversation.status}`} />
        <span className="conversation-title">{conversation.title}</span>
        {conversation.parentSessionKey ? (
          <span className="tree-item-kind" title={tt(t, "conversation.childSessionHint", "Created by another conversation")}>
            {tt(t, "conversation.childSession", "Child")}
          </span>
        ) : null}
        {conversation.runtime?.lastEventIsHeartbeat ? (
          <span className="tree-item-kind heartbeat" title={tt(t, "conversation.heartbeatHint", "Triggered by a scheduled heartbeat")}>
            {tt(t, "conversation.heartbeat", "Heartbeat")}
          </span>
        ) : null}
      </div>
      <span className="tree-item-meta">
        {conversation.agentRuntime ? (
          <span className="tree-item-runtime" title={`Agent Runtime: ${conversation.agentRuntime.id}`}>
            {conversation.agentRuntime.label ?? conversation.agentRuntime.id}
          </span>
        ) : null}
        <span className="tree-item-tokens">{conversation.tokens}</span>
      </span>
    </button>
  );

  if (!visible) {
    return (
      <aside className="resource-sidebar-collapsed">
        <button className="sidebar-handle outside" onClick={onExpand} title={tt(t, "sidebar.expandAgentArea", "Expand agent area")} type="button">
          <span>⟩</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="resource-sidebar">
      <div className="panel-head panel-head-with-actions">
        <button className="ghost-button full-width" type="button" onClick={onCreateAgent}>
          {tt(t, "agent.create", "Create agent")}
        </button>
      </div>
      <button className="sidebar-handle inside" onClick={onCollapse} title={tt(t, "sidebar.hideAgentArea", "Hide agent area")} type="button">
        <span>⟨</span>
      </button>

      <div className="agent-tree flat">
        {agents.map((agent) => {
          const isCollapsed = collapsedAgentIds.has(agent.id);
          const showsAll = expandedAgentIds.has(agent.id);
          const displayConversations = showSystemConversations
            ? agent.conversations
            : agent.conversations.filter((conversation) => !isSystemAutoConversation(conversation));
          const displayConversationIds = new Set(displayConversations.map((conversation) => conversation.id));
          const childrenByParent = new Map<string, Conversation[]>();
          for (const conversation of displayConversations) {
            if (!conversation.parentSessionKey || !displayConversationIds.has(conversation.parentSessionKey)) continue;
            const children = childrenByParent.get(conversation.parentSessionKey) ?? [];
            children.push(conversation);
            childrenByParent.set(conversation.parentSessionKey, children);
          }
          const rootConversations = displayConversations.filter(
            (conversation) => !conversation.parentSessionKey || !displayConversationIds.has(conversation.parentSessionKey),
          );
          const visibleRootConversations = showsAll ? rootConversations : rootConversations.slice(0, 5);
          const hiddenCount = Math.max(0, rootConversations.length - visibleRootConversations.length);
          return (
            <section className="agent-group flat" key={agent.id}>
              <div
                className={`agent-group-head flat ${isCollapsed ? "collapsed" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setCollapsedAgentIds((current) => {
                    const next = new Set(current);
                    if (next.has(agent.id)) {
                      next.delete(agent.id);
                    } else {
                      next.add(agent.id);
                    }
                    return next;
                  });
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") {
                    return;
                  }
                  event.preventDefault();
                  setCollapsedAgentIds((current) => {
                    const next = new Set(current);
                    if (next.has(agent.id)) {
                      next.delete(agent.id);
                    } else {
                      next.add(agent.id);
                    }
                    return next;
                  });
                }}
                aria-expanded={!isCollapsed}
              >
                <div className="agent-group-title">
                  <span className="agent-collapse-icon" aria-hidden>
                    <Icon name={IconNames.ARROW} size={14} className="icon-arrow" />
                  </span>
                  <strong className="agent-name">{agent.name}</strong>
                </div>
                <div className="agent-inline-actions">
                  <button
                    className="icon-only-button"
                    title={tt(t, "agent.editIdentityFile", "Edit identity files")}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEditAgentFiles(agent.id);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="icon-only-button"
                    title={tt(t, "conversation.create", "New conversation")}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCreateConversation(agent.id);
                    }}
                  >
                    ＋
                  </button>
                </div>
              </div>
              {!isCollapsed ? (
                <div className="conversation-tree flat">
                  {visibleRootConversations.flatMap((conversation) => [
                    renderConversationButton(agent.id, conversation, 0),
                    ...(childrenByParent.get(conversation.id) ?? []).map((child) => renderConversationButton(agent.id, child, 1)),
                  ])}
                  {hiddenCount > 0 ? (
                    <button
                      className="conversation-tree-more"
                      type="button"
                      onClick={() => {
                        setExpandedAgentIds((current) => new Set(current).add(agent.id));
                      }}
                    >
                      {tt(t, "common.showMore", "Show more")} {hiddenCount}
                    </button>
                  ) : showsAll && displayConversations.length > 5 ? (
                    <button
                      className="conversation-tree-more"
                      type="button"
                      onClick={() => {
                        setExpandedAgentIds((current) => {
                          const next = new Set(current);
                          next.delete(agent.id);
                          return next;
                        });
                      }}
                    >
                      {tt(t, "common.collapse", "Collapse")}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
