import type { Agent } from "../types/app";
import type { Conversation } from "../types/conversation";

type ResourceSidebarProps = {
  agents: Agent[];
  expandedConversationId: string;
  statusLabel: Record<Conversation["status"], string>;
  onCreateConversation: (agentId: string) => void;
  onToggleConversationVisibility: (agentId: string, conversationId: string, visible: boolean) => void;
  onExpandedConversationChange: (conversationId: string) => void;
  onOpenConversation?: (conversationId: string) => void | Promise<void>;
  onCollapse: () => void;
  onExpand: () => void;
  visible: boolean;
};

export function ResourceSidebar({
  agents,
  expandedConversationId,
  statusLabel,
  onCreateConversation,
  onToggleConversationVisibility,
  onExpandedConversationChange,
  onOpenConversation,
  onCollapse,
  onExpand,
  visible,
}: ResourceSidebarProps) {
  if (!visible) {
    return (
      <aside className="resource-sidebar-collapsed">
        <button className="sidebar-handle outside" onClick={onExpand} title="展开 Agent 区域" type="button">
          <span>⟩</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="resource-sidebar">
      <div className="panel-head panel-head-with-actions">
        <button className="ghost-button full-width" type="button">
          新建 Agent
        </button>
      </div>
      <button className="sidebar-handle inside" onClick={onCollapse} title="隐藏 Agent 区域" type="button">
        <span>⟨</span>
      </button>

      <div className="agent-tree flat">
        {agents.map((agent) => (
          <section className="agent-group flat" key={agent.id}>
            <div className="agent-group-head flat">
              <div className="agent-group-title">
                <strong className="agent-name">{agent.name}</strong>
              </div>
              <div className="agent-inline-actions">
                <button className="icon-only-button" title="新建对话" type="button" onClick={() => onCreateConversation(agent.id)}>
                  ＋
                </button>
              </div>
            </div>
            <div className="conversation-tree flat">
              {agent.conversations.map((conversation) => (
                <button
                  className={`conversation-tree-item flat ${conversation.visible ? "visible" : "hidden"} ${expandedConversationId === conversation.id ? "selected" : ""}`}
                  key={conversation.id}
                  onClick={() => {
                    if (!conversation.visible) {
                      onToggleConversationVisibility(agent.id, conversation.id, true);
                    }
                    onExpandedConversationChange(conversation.id);
                    onOpenConversation?.(conversation.id);
                  }}
                  type="button"
                >
                  <div className="conversation-title-wrap">
                    <span className={`status-dot ${conversation.status}`} />
                    <span className="conversation-title">{conversation.title}</span>
                  </div>
                  <span className="tree-item-tokens">{conversation.tokens}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}
