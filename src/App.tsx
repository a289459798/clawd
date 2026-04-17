import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./App.css";

type NavKey = "conversations" | "skills" | "connections";
type AgentStatus = "working" | "completed" | "idle";
type ConversationStatus = "working" | "completed" | "idle";

type Conversation = {
  id: string;
  title: string;
  status: ConversationStatus;
  lastMessage: string;
  lastTime: string;
  tokens: string;
  model: string;
  workspace: string;
  visible: boolean;
  pinned?: boolean;
  previewMessages?: Array<{ role?: string; text: string }>;
};

type Agent = {
  id: string;
  name: string;
  color: string;
  status: AgentStatus;
  model: string;
  mdFile: string;
  configPath: string;
  summary: string;
  conversations: Conversation[];
};

type Skill = {
  id: string;
  name: string;
  summary: string;
  location: string;
  enabled: boolean;
};

type ChannelConnection = {
  id: string;
  name: string;
  status: "connected" | "warning" | "disabled";
  detail: string;
  config: string;
  activity: string;
};

type OpenClawSnapshot = {
  agents: Array<{ id: string; name: string; workspace?: string; model?: string; agent_dir?: string }>;
  sessions: Array<{
    id: string;
    agent_id: string;
    key: string;
    title: string;
    updated_at?: number;
    channel?: string;
    session_file?: string;
    last_message?: string;
    last_role?: string;
    preview_messages: Array<{ role?: string; text: string }>;
  }>;
  connections: Array<{ id: string; name: string; enabled: boolean }>;
  skills: Array<{ id: string; name: string; location: string }>;
};

const agentsSeed: Agent[] = [
  {
    id: "master",
    name: "Master Bot",
    color: "#52f2c5",
    status: "working",
    model: "gpt-5.4",
    mdFile: "master.md",
    configPath: "~/.openclaw/bots/master/config.json",
    summary: "负责主调度和工作区总览。",
    conversations: [
      {
        id: "master-1",
        title: "桌面端结构重做",
        status: "working",
        lastMessage: "正在把页面改成顶部栏 + 左侧导航 + 主工作区。",
        lastTime: "刚刚",
        tokens: "12.6K",
        model: "gpt-5.4",
        workspace: "/Users/zhangzy/Workspace/clawx",
        visible: true,
        pinned: true,
      },
      {
        id: "master-2",
        title: "OpenClaw 对话切换体验",
        status: "idle",
        lastMessage: "需要把 agent 和对话做成树形结构。",
        lastTime: "18 分钟前",
        tokens: "4.1K",
        model: "gpt-5.4",
        workspace: "/Users/zhangzy/Workspace/clawx",
        visible: true,
      },
      {
        id: "master-3",
        title: "旧版统计面板",
        status: "completed",
        lastMessage: "已确认右侧常驻统计不适合作为主界面结构。",
        lastTime: "今天 14:52",
        tokens: "3.2K",
        model: "gpt-5.4",
        workspace: "/Users/zhangzy/Workspace/clawx",
        visible: false,
      },
    ],
  },
  {
    id: "coder",
    name: "Coding Agent",
    color: "#7aa2ff",
    status: "working",
    model: "claude-opus-4.6",
    mdFile: "coding-agent.md",
    configPath: "~/.openclaw/agents/coding-agent.json",
    summary: "处理代码分析、改造和调试。",
    conversations: [
      {
        id: "coder-1",
        title: "clawx 页面改造",
        status: "working",
        lastMessage: "已经开始替换原来的 dashboard 结构。",
        lastTime: "2 分钟前",
        tokens: "18.8K",
        model: "claude-opus-4.6",
        workspace: "/Users/zhangzy/Workspace/clawx",
        visible: true,
        pinned: true,
      },
      {
        id: "coder-2",
        title: "adapter 接口草案",
        status: "completed",
        lastMessage: "需要补 listAgents、listSessions、openWebUi 这些方法。",
        lastTime: "今天 10:11",
        tokens: "6.3K",
        model: "claude-opus-4.6",
        workspace: "/Users/zhangzy/Workspace/clawx/docs",
        visible: false,
      },
    ],
  },
  {
    id: "investor",
    name: "Investment Advisor",
    color: "#f08b7d",
    status: "idle",
    model: "gpt-4.1",
    mdFile: "investment_advisor.md",
    configPath: "~/.openclaw/bots/investment_advisor/config.json",
    summary: "负责市场分析和投资建议。",
    conversations: [
      {
        id: "investor-1",
        title: "A 股收盘复盘",
        status: "idle",
        lastMessage: "等待新的市场数据输入。",
        lastTime: "35 分钟前",
        tokens: "5.7K",
        model: "gpt-4.1",
        workspace: "/Users/zhangzy/clawd",
        visible: false,
      },
    ],
  },
];

const fallbackSkills: Skill[] = [
  {
    id: "coding-agent",
    name: "coding-agent",
    summary: "把较大的编码任务委托给 Codex / Claude Code / Pi。",
    location: "skills/coding-agent/SKILL.md",
    enabled: true,
  },
  {
    id: "taskflow",
    name: "taskflow",
    summary: "适合做任务流梳理和结构化推进。",
    location: "skills/taskflow/SKILL.md",
    enabled: true,
  },
  {
    id: "weather",
    name: "weather",
    summary: "查询天气并生成适合当前场景的提醒。",
    location: "skills/weather/SKILL.md",
    enabled: true,
  },
];

const fallbackConnections: ChannelConnection[] = [
  {
    id: "webchat",
    name: "Webchat",
    status: "connected",
    detail: "当前控制台会话来源",
    config: "channels.webchat",
    activity: "刚刚活跃",
  },
  {
    id: "discord",
    name: "Discord",
    status: "connected",
    detail: "Bot 已配置，可发送消息和管理线程",
    config: "channels.discord.token",
    activity: "今天有 14 条消息",
  },
];

const statusLabel: Record<AgentStatus, string> = {
  working: "进行中",
  completed: "已完成",
  idle: "空闲",
};

const connectionLabel: Record<ChannelConnection["status"], string> = {
  connected: "已连接",
  warning: "需检查",
  disabled: "未启用",
};

function App() {
  const [activeNav, setActiveNav] = useState<NavKey>("conversations");
  const [agents, setAgents] = useState(agentsSeed);
  const [expandedConversationId, setExpandedConversationId] = useState("master-1");
  const [showResourceSidebar, setShowResourceSidebar] = useState(true);
  const [skills, setSkills] = useState<Skill[]>(fallbackSkills);
  const [connections, setConnections] = useState<ChannelConnection[]>(fallbackConnections);
  const [composerText, setComposerText] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [voiceDraft, setVoiceDraft] = useState<string | null>(null);
  const [chatSearch, setChatSearch] = useState("");

  useEffect(() => {
    const loadSnapshot = async () => {
      try {
        const snapshot = await invoke<OpenClawSnapshot>("load_openclaw_snapshot");

        if (snapshot.agents.length > 0) {
          const colors = ["#52f2c5", "#7aa2ff", "#f08b7d", "#c08bff", "#f3bf63"];
          setAgents(
            snapshot.agents.map((agent, index) => {
              const existing = agentsSeed.find((item) => item.id === agent.id);
              const realSessions = snapshot.sessions
                .filter((session) => session.agent_id === agent.id)
                .slice(0, 8)
                .map((session, sessionIndex) => ({
                  id: session.key,
                  title: session.title,
                  status:
                    sessionIndex === 0
                      ? "working"
                      : session.updated_at && Date.now() - session.updated_at < 1000 * 60 * 60 * 6
                        ? "idle"
                        : "completed",
                  lastMessage:
                    session.last_message ??
                    (session.session_file
                      ? `会话文件: ${session.session_file.split("/").slice(-1)[0]}`
                      : `来自 ${session.channel ?? "unknown"} 的会话`),
                  previewMessages: session.preview_messages,
                  lastTime: session.updated_at ? new Date(session.updated_at).toLocaleString("zh-CN") : "未知时间",
                  tokens: "--",
                  model: agent.model ?? existing?.model ?? "未配置",
                  workspace: agent.workspace ?? "/Users/zhangzy/clawd",
                  visible: sessionIndex < 3,
                  pinned: sessionIndex === 0,
                }));

              return {
                id: agent.id,
                name: agent.name,
                color: existing?.color ?? colors[index % colors.length],
                status: existing?.status ?? "idle",
                model: agent.model ?? existing?.model ?? "未配置",
                mdFile: existing?.mdFile ?? `${agent.id}.md`,
                configPath: agent.agent_dir ?? existing?.configPath ?? `agents.list.${index}`,
                summary: existing?.summary ?? "来自本地 OpenClaw 配置。",
                conversations: realSessions.length > 0 ? realSessions : existing?.conversations ?? [],
              } as Agent;
            }),
          );
        }

        if (snapshot.skills.length > 0) {
          setSkills(
            snapshot.skills.map((skill) => ({
              id: skill.id,
              name: skill.name,
              summary: "来自本地 OpenClaw skill 目录。",
              location: skill.location,
              enabled: true,
            })),
          );
        }

        if (snapshot.connections.length > 0) {
          setConnections(
            snapshot.connections.map((connection) => ({
              id: connection.id,
              name: connection.name,
              status: connection.enabled ? "connected" : "disabled",
              detail: connection.enabled ? "已从本地 OpenClaw 配置读取" : "当前未启用",
              config: `channels.${connection.id}`,
              activity: connection.enabled ? "配置已启用" : "配置关闭",
            })),
          );
        }
      } catch (error) {
        console.error("Failed to load OpenClaw snapshot", error);
      }
    };

    void loadSnapshot();
  }, []);

  const openLocalOpenClaw = async () => {
    try {
      const dashboardUrl = await invoke<string>("resolve_dashboard_url");
      await openUrl(dashboardUrl);
    } catch (error) {
      console.error("Failed to open OpenClaw dashboard", error);
    }
  };

  const visibleConversations = useMemo(() => {
    return agents
      .flatMap((agent) =>
        agent.conversations
          .filter((conversation) => conversation.visible)
          .map((conversation) => ({
            ...conversation,
            agentId: agent.id,
            agentName: agent.name,
            color: agent.color,
          })),
      )
      .sort((left, right) => {
        const statusRank = { working: 0, idle: 1, completed: 2 };
        const pinnedRank = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
        if (pinnedRank !== 0) return pinnedRank;
        return statusRank[left.status] - statusRank[right.status];
      });
  }, [agents]);

  const filteredVisibleConversations = useMemo(() => {
    const keyword = chatSearch.trim().toLowerCase();
    if (!keyword) return visibleConversations;
    return visibleConversations.filter(
      (conversation) =>
        conversation.title.toLowerCase().includes(keyword) ||
        conversation.lastMessage.toLowerCase().includes(keyword) ||
        conversation.previewMessages?.some((message) => message.text.toLowerCase().includes(keyword)),
    );
  }, [chatSearch, visibleConversations]);

  const activeConversation = filteredVisibleConversations.find((conversation) => conversation.id === expandedConversationId)
    ?? visibleConversations.find((conversation) => conversation.id === expandedConversationId)
    ?? filteredVisibleConversations[0]
    ?? visibleConversations[0]
    ?? null;

  const toggleConversationVisibility = (agentId: string, conversationId: string, visible: boolean) => {
    setAgents((current) =>
      current.map((agent) =>
        agent.id !== agentId
          ? agent
          : {
              ...agent,
              conversations: agent.conversations.map((conversation) =>
                conversation.id !== conversationId ? conversation : { ...conversation, visible },
              ),
            },
      ),
    );

    if (visible) {
      setExpandedConversationId(conversationId);
    } else if (expandedConversationId === conversationId) {
      const nextVisible = visibleConversations.find((conversation) => conversation.id !== conversationId);
      if (nextVisible) {
        setExpandedConversationId(nextVisible.id);
      }
    }
  };

  const handleSendText = () => {
    if (!activeConversation || !composerText.trim()) return;
    const nextText = composerText.trim();
    setAgents((current) =>
      current.map((agent) => ({
        ...agent,
        conversations: agent.conversations.map((conversation) =>
          conversation.id !== activeConversation.id
            ? conversation
            : {
                ...conversation,
                lastMessage: nextText,
                lastTime: "刚刚",
                status: "working",
                previewMessages: [
                  ...(conversation.previewMessages ?? []),
                  { role: "user", text: nextText },
                ].slice(-20),
              },
        ),
      })),
    );
    setComposerText("");
  };

  const addMockFile = () => {
    const nextIndex = selectedFiles.length + 1;
    setSelectedFiles((current) => [...current, `mock-file-${nextIndex}.png`]);
  };

  const toggleVoiceDraft = () => {
    setVoiceDraft((current) => (current ? null : "voice-note-001.m4a"));
  };

  return (
    <main className="app-shell">
      <div
        className={`layout no-topbar ${
          activeNav === "conversations"
            ? showResourceSidebar
              ? "with-resource-sidebar"
              : "without-resource-sidebar"
            : "content-only"
        }`}
      >
        <aside className="nav-sidebar">
          <div className="nav-group">
            <button
              className={`nav-item ${activeNav === "conversations" ? "active" : ""}`}
              onClick={() => setActiveNav("conversations")}
              type="button"
            >
              对话
            </button>
            <button
              className={`nav-item ${activeNav === "skills" ? "active" : ""}`}
              onClick={() => setActiveNav("skills")}
              type="button"
            >
              技能
            </button>
            <button
              className={`nav-item ${activeNav === "connections" ? "active" : ""}`}
              onClick={() => setActiveNav("connections")}
              type="button"
            >
              连接
            </button>
          </div>

          <div className="sidebar-bottom-actions">
            <button className="nav-icon-button" onClick={() => void openLocalOpenClaw()} title="打开本地 OpenClaw" type="button">
              🌐
            </button>
          </div>
        </aside>

        {activeNav === "conversations" ? (
          <>
            {showResourceSidebar ? (
              <aside className="resource-sidebar">
                <div className="panel-head panel-head-with-actions">
                  <button className="ghost-button full-width" type="button">
                    新建 Agent
                  </button>
                </div>
                <button
                  className="sidebar-handle inside"
                  onClick={() => setShowResourceSidebar(false)}
                  title="隐藏 Agent 区域"
                  type="button"
                >
                  <span>⟨</span>
                </button>

                <div className="agent-tree flat">
                  {agents.map((agent) => (
                    <section className="agent-group flat" key={agent.id}>
                      <div className="agent-group-head flat">
                        <div className="agent-group-title">
                          <span className="color-dot" style={{ backgroundColor: agent.color }} />
                          <strong className="agent-name">{agent.name}</strong>
                        </div>
                        <div className="agent-inline-actions">
                          <button className="icon-only-button" title="新建对话" type="button">
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
                                toggleConversationVisibility(agent.id, conversation.id, true);
                              } else {
                                setExpandedConversationId(conversation.id);
                              }
                            }}
                            type="button"
                          >
                            <span className="conversation-title">{conversation.title}</span>
                            <div className="conversation-inline-meta">
                              <span>{conversation.tokens}</span>
                              <span className={`status-badge ${conversation.status}`}>
                                {statusLabel[conversation.status]}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </aside>
            ) : (
              <aside className="resource-sidebar-collapsed">
                <button
                  className="sidebar-handle outside"
                  onClick={() => setShowResourceSidebar(true)}
                  title="展开 Agent 区域"
                  type="button"
                >
                  <span>⟩</span>
                </button>
              </aside>
            )}

            <section className="workspace-area chat-workspace-area">
              <div className="chat-page-head">
                <div className="search-box wide chat-search-shell">
                  <input
                    className="chat-search-input"
                    onChange={(event) => setChatSearch(event.target.value)}
                    placeholder="搜索对话标题、摘要或历史消息"
                    value={chatSearch}
                  />
                </div>
                <div className="chat-page-actions">
                  <button className="ghost-button" type="button">
                    新建对话
                  </button>
                  <button className="ghost-button" type="button">
                    刷新历史
                  </button>
                </div>
              </div>

              <div className="conversation-grid chat-layout-single">
                {(activeConversation ? [activeConversation] : []).map((conversation) => {
                  const expanded = true;
                  return (
                    <article
                      className={`conversation-card ${expanded ? "expanded" : "compact"} ${conversation.status}`}
                      key={conversation.id}
                      onClick={() => {
                        if (!expandedConversationId) {
                          setExpandedConversationId(conversation.id);
                        }
                      }}
                    >
                      <div className="conversation-card-head">
                        <div>
                          <div className="card-row">
                            <strong>{conversation.title}</strong>
                          </div>
                          <p>
                            {conversation.agentName} · {conversation.model}
                          </p>
                        </div>
                        <div className="card-actions">
                          <button
                            className="icon-only-button subtle"
                            onClick={(event) => {
                              event.stopPropagation();
                              setExpandedConversationId((current) => (current === conversation.id ? "" : conversation.id));
                            }}
                            title={expanded ? "缩小" : "展开"}
                            type="button"
                          >
                            {expanded ? "⤡" : "⤢"}
                          </button>
                          {!expanded ? (
                            <button
                              className="icon-only-button subtle"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleConversationVisibility(conversation.agentId, conversation.id, false);
                              }}
                              title="隐藏"
                              type="button"
                            >
                              ✕
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <div className="conversation-summary">
                        <p>{conversation.lastMessage}</p>
                        <div className="summary-meta">
                          <span>{conversation.workspace}</span>
                          <span>{conversation.tokens}</span>
                          <span>{conversation.lastTime}</span>
                        </div>
                        <div className="card-status-corner">
                          <span className={`status-badge ${conversation.status}`}>
                            {statusLabel[conversation.status]}
                          </span>
                        </div>
                      </div>

                      {expanded ? (
                        <div className="conversation-expanded">
                          <div className="expanded-meta-row">
                            <div className="expanded-meta-card">
                              <span className="section-title">工作目录</span>
                              <p>{conversation.workspace}</p>
                            </div>
                            <div className="expanded-meta-card">
                              <span className="section-title">模型</span>
                              <p>{conversation.model}</p>
                            </div>
                            <div className="expanded-meta-card">
                              <span className="section-title">Token</span>
                              <p>{conversation.tokens}</p>
                            </div>
                          </div>
                          <div className="expanded-section chat-like">
                            <span className="section-title">最近上下文</span>
                            {(conversation.previewMessages && conversation.previewMessages.length > 0
                              ? conversation.previewMessages
                              : [{ role: "assistant", text: conversation.lastMessage }]
                            ).map((message, index) => {
                              const role = message.role?.toLowerCase() ?? "assistant";
                              const bubbleClass =
                                role === "user" ? "user" : role === "system" ? "system" : "assistant";
                              const roleLabel =
                                role === "user" ? "User" : role === "system" ? "System" : "Assistant";
                              return (
                                <div className={`message-bubble ${bubbleClass}`} key={`${conversation.id}-${index}`}>
                                  <span className="message-role">{roleLabel}</span>
                                  <p>{message.text}</p>
                                </div>
                              );
                            })}
                          </div>
                          <div className="expanded-section composer-section">
                            <span className="section-title">发送消息</span>
                            <div className="composer-toolbar">
                              <button className="tiny-button" onClick={addMockFile} type="button">
                                添加文件
                              </button>
                              <button className={`tiny-button ${voiceDraft ? "active" : ""}`} onClick={toggleVoiceDraft} type="button">
                                {voiceDraft ? "移除语音" : "语音草稿"}
                              </button>
                              <button className="tiny-button" type="button">
                                文本模式
                              </button>
                            </div>

                            {selectedFiles.length > 0 ? (
                              <div className="attachment-list">
                                {selectedFiles.map((file) => (
                                  <span className="attachment-chip" key={file}>
                                    {file}
                                  </span>
                                ))}
                              </div>
                            ) : null}

                            {voiceDraft ? (
                              <div className="voice-draft-card">
                                <span className="section-title">语音草稿</span>
                                <p>{voiceDraft}</p>
                              </div>
                            ) : null}

                            <div className="composer-box">
                              <textarea
                                className="composer-textarea"
                                onChange={(event) => setComposerText(event.target.value)}
                                placeholder="给当前对话输入消息，后续这里会直接接 OpenClaw chat.send / 文件 / 语音上传。"
                                value={composerText}
                              />
                              <div className="composer-actions-row">
                                <span className="composer-hint">目标: 文本、文件、语音三种发送入口统一到对话页</span>
                                <button className="icon-text-button" onClick={handleSendText} type="button">
                                  发送
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
              {!activeConversation ? (
                <div className="empty-chat-state">
                  <strong>还没有可显示的对话</strong>
                  <p>先从左侧 Agent 树里展开一个会话，后续这里会支持直接新建对话。</p>
                </div>
              ) : null}
            </section>
          </>
        ) : null}

        {activeNav === "skills" ? (
          <section className="single-page">
            <div className="page-head-row">
              <div className="search-box wide">搜索 skill 名称或用途</div>
              <button className="ghost-button" type="button">
                刷新技能
              </button>
            </div>
            <div className="card-grid-panel">
              {skills.map((skill) => (
                <article className="info-card" key={skill.id}>
                  <div className="card-row">
                    <strong>{skill.name}</strong>
                    <span className={`toggle-badge ${skill.enabled ? "enabled" : "disabled"}`}>
                      {skill.enabled ? "已启用" : "未启用"}
                    </span>
                  </div>
                  <p>{skill.summary}</p>
                  <span className="path-text stacked">{skill.location}</span>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {activeNav === "connections" ? (
          <section className="single-page">
            <div className="card-grid-panel">
              {connections.map((connection) => (
                <article className="info-card" key={connection.id}>
                  <div className="card-row">
                    <strong>{connection.name}</strong>
                    <span className={`toggle-badge ${connection.status}`}>
                      {connectionLabel[connection.status]}
                    </span>
                  </div>
                  <p>{connection.detail}</p>
                  <div className="connection-meta stacked">
                    <span>{connection.config}</span>
                    <span>{connection.activity}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

export default App;
