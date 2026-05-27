export type AgentTemplate = {
  id: string;
  emoji: string;
  agentId: string;
  nameKey: string;
  summaryKey: string;
  descriptionKey: string;
};

export const AGENT_DESCRIPTION_FILE = "AGENTS.md";

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "research",
    emoji: "🔎",
    agentId: "research",
    nameKey: "agent.template.research.name",
    summaryKey: "agent.template.research.summary",
    descriptionKey: "agent.template.research.description",
  },
  {
    id: "writing",
    emoji: "✍️",
    agentId: "writing",
    nameKey: "agent.template.writing.name",
    summaryKey: "agent.template.writing.summary",
    descriptionKey: "agent.template.writing.description",
  },
  {
    id: "ops",
    emoji: "🧰",
    agentId: "ops",
    nameKey: "agent.template.ops.name",
    summaryKey: "agent.template.ops.summary",
    descriptionKey: "agent.template.ops.description",
  },
  {
    id: "support",
    emoji: "💬",
    agentId: "support",
    nameKey: "agent.template.support.name",
    summaryKey: "agent.template.support.summary",
    descriptionKey: "agent.template.support.description",
  },
];
