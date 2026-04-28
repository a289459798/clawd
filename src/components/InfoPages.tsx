import type { ChannelConnection, Skill } from "../types/app";

export function SkillsPage({ skills }: { skills: Skill[] }) {
  return (
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
  );
}

export function ConnectionsPage({ connections, connectionLabel }: {
  connections: ChannelConnection[];
  connectionLabel: Record<ChannelConnection["status"], string>;
}) {
  return (
    <section className="single-page">
      <div className="card-grid-panel">
        {connections.map((connection) => (
          <article className="info-card" key={connection.id}>
            <div className="card-row">
              <strong>{connection.name}</strong>
              <span className={`toggle-badge ${connection.status}`}>{connectionLabel[connection.status]}</span>
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
  );
}
