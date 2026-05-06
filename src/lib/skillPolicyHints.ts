import type { SkillPolicyHint } from "../types/app";

type SkillStatusLike = {
  name?: string;
  blockedByAllowlist?: boolean;
  blockedByAgentFilter?: boolean;
  eligible?: boolean;
  install?: Array<{ id: string; label: string; kind: string }>;
};

export function buildSkillPolicyHints(skill: SkillStatusLike): SkillPolicyHint[] {
  const hints: SkillPolicyHint[] = [];

  if (skill.blockedByAllowlist) {
    hints.push({
      severity: "warning",
      title: "被 bundled allowlist 阻止",
      body: "当前 OpenClaw 配置不允许加载该技能对应的插件形态。需要调整 allowlist / bundled 策略或使用 doctor 修复后再启用。",
      actions: [
        { label: "尝试 doctor 修复", cli: "openclaw doctor --fix" },
        { label: "查阅技能 CLI", docUrl: "https://docs.openclaw.ai/cli/skills" },
      ],
    });
  }

  if (skill.blockedByAgentFilter) {
    hints.push({
      severity: "warning",
      title: "被 Agent 技能过滤器排除",
      body: "该 Agent 的 skill filter 未包含此技能名称，Gateway 不会把它提供给模型。请在对应 Agent 配置中放开过滤器或改用默认 Agent。",
      actions: [{ label: "查阅 Agent 配置", docUrl: "https://docs.openclaw.ai/start/getting-started" }],
    });
  }

  if (
    skill.eligible === false &&
    Array.isArray(skill.install) &&
    skill.install.length > 0 &&
    !skill.blockedByAllowlist &&
    !skill.blockedByAgentFilter
  ) {
    const labels = skill.install.map((opt) => opt.label.trim()).filter(Boolean);
    hints.push({
      severity: "info",
      title: "可先安装依赖组件",
      body: `Gateway 报告该技能仍有未满足的依赖。官方首选安装描述：${labels.join(" · ") || "见技能元数据"}`,
      actions: [
        { label: "检查技能与依赖（CLI）", cli: "openclaw skills check" },
        { label: "技能文档索引", docUrl: "https://docs.openclaw.ai/cli/skills" },
      ],
    });
  }

  return hints;
}
