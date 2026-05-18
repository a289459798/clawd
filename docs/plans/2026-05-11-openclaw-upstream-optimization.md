# OpenClaw 上游更新 → ClawKit 优化 backlog

> 创建日期：2026-05-11  
> 依据：OpenClaw `CHANGELOG.md`（尤其 `## Unreleased`）、本地 `clawdbot` 仓库对照、ClawKit 当前实现扫描。  
> 范围：ClawKit 作为 **Gateway 客户端 + 配置壳**，不平行实现通道/自动化内核。
> 版本基线：`openclaw@latest` 当前为 `2026.5.12`（GitHub `v2026.5.12` stable，npm `latest`）。本文后续按 `2026.5.12` 正式版规划；`2026.5.14-beta.*` 仅作为观察项，不进入默认排期。

与 **2026-04-24 之后通用 changelog 跟进** 重叠的条目，仍以主清单为准：

- 主清单：[`2026-05-06-changelog-followup-checklist.md`](./2026-05-06-changelog-followup-checklist.md)（大量 P0/P1 已勾选）

本文档专门跟踪：**相对上述主清单仍缺一环**、且与 **OpenClaw 2026.5.12** 能力强相关的增量项，并按优先级排序。

---

## 状态标识（完成度）

| 标记 | 含义 |
|------|------|
| `[ ]` | **未开始** |
| `[~]` | **进行中**（已开分支或 PR 中，合入前勿标 `[x]`） |
| `[x]` | **已完成**（已合入 `main` 或当前开发分支，且行为与 Gateway schema 对齐） |
| `[-]` | **不计划**（明确超出工作台范围；保留决策记录） |

勾选时请在条目下补一行 **完成说明**（可选）：PR 链接、涉及文件或验证方式。

---

## 优先级说明

| 级别 | 含义 |
|------|------|
| **P1** | 与上游新 RPC/新配置强相关，对工作台日常价值高；建议优先排期。 |
| **P2** | 依赖上游 RPC 稳定性或仅部分用户需要；有清晰价值后再做。 |
| **P3** | 文案/排障/高级配置展示为主，或随上游版本自然满足。 |

---

## 2026.5.12 正式版影响摘要

### ClawKit 应主动跟进

- 普通用户入口：新建 Agent 应增加「Agent 说明」与常用模板卡片，用户点选后自动填好 ID / 名称 / 工作目录 / 说明，再允许手动修改。
- 普通用户入口：新建定时任务应从 cron 表达式表单改为「做什么、谁来做、什么时候做」的向导；内置常用任务模板，默认隐藏 Cron/RRULE 等底层概念。
- Gateway protocol：`2026.5.12` 要求 v4 客户端，并开始显式流式 `deltaText` / `replace` frame；ClawKit 需要确认 `gateway_proxy` 与 `useGatewayChat` 不再依赖本地 diff 猜测。
- Control UI/WebChat：上游新增持久化 auto-scroll 模式选择；ClawKit 对话页也应提供类似偏好，避免长输出时强制滚动。
- Sessions/Gateway：上游修正 ACP spawn-child session kind 与 runtime metadata；ClawKit 侧栏树和会话详情应消费 canonical row，而不是靠 key 规则猜。
- Replies/WebChat：上游修复 rich-only / button-only / presentation 回复投递；ClawKit 消息渲染需避免把“无文本但有结构化内容”的 assistant 消息丢掉。
- OpenClaw 版本门槛：`RECOMMENDED_OPENCLAW_CLI_VERSION` 应从 `2026.5.10` 提到 `2026.5.12`；zip 技能安装最低门槛可继续保留在首个支持版本，但 UI 推荐升级用 5.12。

### 暂不作为 ClawKit 主路径

- Telegram isolated polling、Slack/Telegram/Discord channel 细节、provider JSON 解析防御：主要由 Gateway / channel plugin 自身负责，ClawKit 最多在连接页显示状态或排障链接。
- `acp.fallbacks`、`agents.defaults.runRetries`、`tools.exec.commandHighlighting`、per-sender tool policies：先做配置只读/文档入口；不在 ClawKit 内重建 OpenClaw 配置编辑器。
- Telnyx / Discord realtime voice：ClawKit 先做 Talk/Voice 可用性探测，不做完整实时语音 UI。

---

## 基线（已实现，本 backlog 不重复开任务）

以下已在 ClawKit 落地或与主 checklist 已勾选项等价，**此处仅作对齐说明**，不在下方重复列 `[x]`：

- [x] Gateway `maxProtocol: 4`、会话 `sessions.patch` 中 `thinking_level` / `fast_mode` 支持传 `null` 恢复默认（含 Composer 入口）。
- [x] 设置项 `skills.install.allowUploadedArchives` + OpenClaw CLI **最低版本**门槛与醒目提示。
- [x] 定时页：`cron.list` / `cron.runs` / add-update-remove-run 等 Gateway 桥接（见 `gateway_proxy.rs`、`CronPage.tsx`）。
- [x] 主 checklist 中 P0「对话与会话」「Gateway 和解」、P1「模型与 auth」「通道诊断」「cron 列表与运行记录」等已勾选块。

若回归失败，应修 bug 而非在本表新开条目。

---

## P0：2026.5.12 兼容性

### 0.1 Gateway v4 显式流式 frame 兼容

- **上游**：Gateway protocol 要求 v4 clients，并流式发送显式 `deltaText` / `replace` frame。
- **目标**：更新 `GatewayChatEvent` / `GatewayMessage` 类型与 `useGatewayChat` 合并逻辑；优先使用 Gateway 提供的 `deltaText` / `replace` 语义，避免把 replace 当 append。
- **验收要点**：长回复、工具后续回复、final reconciliation 均不重复、不丢字、不倒退；旧 Gateway payload 仍可 fallback。
- **状态**：`[ ]`

### 0.2 推荐 OpenClaw 版本提升到 `2026.5.12`

- **上游**：npm `latest` 已是 `2026.5.12`；GitHub `v2026.5.12` 为 stable。
- **目标**：把 ClawKit 的推荐版本提示更新到 `2026.5.12`；zip 技能安装最低版本常量可继续代表“首个支持版本”，不要误用为推荐版本。
- **状态**：`[ ]`

### 0.3 Rich-only / presentation 回复不丢失

- **上游**：`2026.5.12` 修复 rich presentation、interactive controls、button-only replies 在 WebChat/TUI 的投递与镜像。
- **目标**：ClawKit 消息流识别结构化 content / presentation / media-only assistant 消息；即使文本为空，也保留可渲染块或至少展示可读占位。
- **状态**：`[ ]`

---

## P1：建议优先

> 实施前请在本地 OpenClaw / `clawdbot` 核对 **Gateway 方法名与 JSON 字段**，避免写入 schema 不接受的字段（见 `AGENTS.md`）。

### 1.1 新建 Agent：模板选择 + Agent 说明字段

- **用户价值**：普通用户不需要先理解 Agent 配置文件；先从「诊断辅助 / 病历整理 / 主人沟通 / 药品与处方 / 术后回访 / 学习与文献」这类模板开始，再按自己的业务改。
- **目标**：`AgentCreateDialog` 增加模板区和「Agent 说明」多行输入；点选模板后自动填充 `agentId`、名称、默认工作目录建议和说明文本，用户仍可覆盖。
- **实现边界**：
  - 新增模板先放在 `src/lib/` 的纯数据/转换器中，显示文案全部接入 i18n key；不要把行业模板写死在 JSX 里。
  - 创建 Agent 仍通过 Gateway/Tauri 现有 create 路径；不要绕过 Gateway 直接改 OpenClaw agent 注册配置。
  - 「Agent 说明」落地前先核对 OpenClaw Gateway 是否支持 create/update 携带说明字段；若不支持，应在创建成功后走 `agents.files.*` 可编辑身份文件 API 写入说明文件，而不是往 `agents.create` 塞 schema 不接受的字段。
  - 模板应是通用预设，不把某个行业做成唯一入口；图片里的宠物医院模板可作为示例模板组或后续行业包。
- **验收要点**：选择模板后字段自动填充且可编辑；空白创建路径仍可用；深色/浅色均可读；创建失败时不丢用户已填写的说明。
- **状态**：`[ ]`

### 1.2 新建定时任务：傻瓜式向导 + 常用模板

- **用户价值**：用户只需要说明“让 AI 做什么”和“什么时候执行”，不需要理解 cron 表达式、RRULE、delivery mode、isolated session 等术语。
- **目标**：将新建任务入口改成分步向导：1）这个任务是做什么的；2）什么时候执行；3）确认执行方式。顶部提供常用任务模板，点选后自动填充任务名、任务说明、Agent、时间建议。
- **默认交互**：
  - 「由谁来做」默认使用默认 Agent，并给出“不了解就保持默认”的轻提示。
  - 时间选择优先使用卡片：每天、每周、每隔、指定时间；只在「高级」折叠区暴露 cron 表达式。
  - 提交前展示自然语言预览，例如「每天 09:00 由 默认 Agent 执行：整理今日预约」。
  - 投递方式默认走当前产品最稳妥的默认值；Webhook、静默运行、独立会话等放到高级区。
- **实现边界**：
  - 前端可以提供模板和自然语言表单，但最终仍转换为 Gateway 已接受的 `cron.add` / `cron.update` schedule payload。
  - 编辑已有高级 cron 任务时不要丢失原始配置；无法映射成卡片的 schedule 应进入高级模式并展示可读说明。
  - 文案、按钮、错误、aria-label 全部接入 i18n；错误信息避免只说 “cron invalid”，要告诉用户该改哪个时间字段。
- **验收要点**：新手可不接触 cron 完成创建；高级用户仍能编辑 cron 表达式；模板套用后所有字段可再修改；保存后列表可通过 `cron.list` / `cron.get` reconciliation。
- **状态**：`[ ]`

### 1.3 Gateway `cron.get` 与定时页一致性

- **上游**：`cron.get`、`openclaw cron get <id>`。
- **目标**：编辑/展开前拉取单条 canonical 任务；可选「复制 CLI 调试命令」。
- **状态**：`[ ]`

### 1.4 对话页 auto-scroll 模式

- **上游**：Control UI/WebChat 新增持久化 auto-scroll mode：near-bottom、always follow、manual/new messages。
- **目标**：ConversationDetail 增加轻量模式选择，并持久化到本地偏好；流式输出、工具输出和历史 reconciliation 均遵守该偏好。
- **状态**：`[ ]`

### 1.5 技能页：Zip 安装闭环（不仅设置开关）

- **上游**：`allowUploadedArchives` 开启后，可信客户端可经 Gateway 安装 zip 技能。
- **Gateway 流程**：`skills.upload.begin` → `skills.upload.chunk` → `skills.upload.commit` → `skills.install { source: "upload" }`。
- **目标**：`SkillsPage`（或等价入口）提供选 zip → 分片上传 → commit → install → 进度/错误文案；与版本门槛、`skills.install.allowUploadedArchives` 开关联动禁用。
- **状态**：`[ ]`  
- **验收要点**：安装前展示代码安装风险确认；失败时区分「开关未启用」「校验失败」「安装失败」；不要绕过 Gateway 直接解压写技能目录。

### 1.6 侧栏会话树：`parentSessionKey` / `spawn-child` 嵌套展示

- **上游**：Control UI 对子代理会话的树形/前缀展示；`2026.5.12` 修正 ACP spawn-child kind 与 runtime metadata。
- **目标**：利用 `sessions.list` 中 `parentSessionKey` / `childSessions` / `kind` / `agentRuntime`（类型已部分存在于 `src/types/gateway.ts`）折叠或缩进子会话，并显示 runtime/source 小标签。
- **状态**：`[ ]`

### 1.7 实时事件：区分 `isHeartbeat`（若 payload 已下发）

- **上游**：agent 事件可选 `isHeartbeat`。
- **目标**：会话状态或活动摘要中区分「定时心跳」与「用户触发生成」。
- **状态**：`[ ]`  
- **前置**：确认当前 WebSocket/事件订阅是否已包含该字段。

### 1.8 模型页：OpenAI Provider 登录路径说明（Codex/ChatGPT 默认 vs API Key）

- **上游**：`openclaw models auth login --provider openai` 默认 ChatGPT/Codex 账号；`--method api-key` 为显式 API Key。
- **目标**：模型页文案或可复制命令块，避免用户误以为只有 API Key 一条路。
- **状态**：`[ ]`

### 1.9 会话模型：退役 Gemini 3 Pro Preview → 3.1 的一行引导

- **上游**：多处将旧 id 规范到 `google/gemini-3.1-pro-preview`。
- **目标**：当会话当前模型仍为旧 id 时，Composer 或详情条展示简短迁移提示（链文档或 `sessions.patch` 引导）。
- **状态**：`[ ]`

### 1.10 本地模型 provider `localService` 状态提示

- **上游**：provider-level `localService` 可在 OpenAI-compatible 请求前按需启动本地模型服务，并支持 one-shot probe。
- **目标**：模型页只读展示 provider 是否声明 local service；发送失败时把“本地服务启动/探测失败”解释成可操作错误。
- **状态**：`[ ]`

---

## P2：按需排期

### 2.1 Talk / 实时语音：仅探测与文档，不做完整语音 UI

- **上游**：Telnyx realtime、Talk 配置扩展；本地 `clawdbot` 已暴露 `talk.catalog`、`talk.config`、`talk.client.*`、`talk.session.*`、`talk.speak`、`talk.mode` 等 Gateway 方法。
- **目标**：先做只读探测（是否配置、可用 provider/mode、文档入口）和可读错误说明；暂不做完整语音 UI、WebRTC 音频采集或实时会话控制面板。
- **状态**：`[ ]`（与主 checklist「P2: Talk, Pairing, And Voice」一致，可合并跟踪）

### 2.2 远程 Gateway / 配对：配对码解析与非 loopback 策略

- **上游**：Control UI loopback 校验、私网 `ws://` 安全说明。
- **目标**：若产品支持非本机 Gateway：解析复制配对码、显式允许私网地址的策略与文案。
- **状态**：`[ ]`

### 2.3 Matrix：E2EE / SAS 仅状态与外链

- **上游**：Matrix 多项加密与验证修复。
- **目标**：连接页仅展示状态 + 引导至 CLI/Control UI，不在 ClawKit 内实现 Matrix 加密。
- **状态**：`[ ]`

### 2.4 斜杠指令（如 `/context map`）

- **上游**：新上下文可视化能力。
- **目标**：若需统一体验：Composer 支持发送指令或文档链接；不自研 treemap 渲染除非有明确需求。
- **状态**：`[ ]`

### 2.5 ACP：子代理关系图

- **上游**：ACP 暴露 session lineage。
- **目标**：先把 lineage 信息落到侧栏树和 session detail；只有当用户需要全局可视化时再做图谱。
- **状态**：`[ ]`

### 2.6 高级安全：`per-sender` 工具策略等

- **上游**：按 channel sender 限制危险工具。
- **目标**：设置或文档入口：只读展示相关配置键 + 链至官方 Capabilities 文档。
- **状态**：`[ ]`

### 2.7 `acp.fallbacks` 只读/文档入口

- **上游**：ACP turns 可在主 runtime 不可用且未输出前尝试备用 backend。
- **目标**：在模型/Agent 详情中只读提示当前 agent 是否声明 ACP fallback；配置编辑仍交给 OpenClaw config / CLI。
- **状态**：`[ ]`

---

## P3：低优先级或随版本/文档消化

### 3.1 Exec 审批：`tools.exec.commandHighlighting`

- **目标**：若未来在 ClawKit 展示 exec 审批 UI，再对接该配置。
- **状态**：`[ ]`

### 3.2 `chat.send` 单次生成 token 上限

- **上游**：OpenAI 兼容 HTTP 路径已尊重 `max_completion_tokens` / `max_tokens`。
- **当前结论**：本地 `clawdbot` 的 Gateway `ChatSendParamsSchema` 暂未暴露等价字段，且 `additionalProperties: false`；ClawKit 不应向 `chat.send` 追加 schema 不接受的字段。
- **目标**：仅当 Gateway `chat.send` schema 明确新增 token 上限字段后，再评估 Composer 控件与 Tauri 透传。
- **状态**：`[ ]`

### 3.3 `agents.defaults.runRetries` / 嵌入式 Pi 参数

- **目标**：以只读配置提示或文档链接为主，非主工作台路径。
- **状态**：`[ ]`

### 3.4 环境类排障（pnpm 11、sqlite-vec 全局安装、Baileys 等）

- **目标**：安装失败/OpenClaw 信息弹层中链到上游排障说明即可。
- **状态**：`[ ]`

---

## 维护约定

1. **合并前**：将对应条目标为 `[~]`，合入并验证后改为 `[x]`，可附 PR 或 commit。  
2. **与主 checklist 重复**：若某条已在 [`2026-05-06-changelog-followup-checklist.md`](./2026-05-06-changelog-followup-checklist.md) 勾选，本表对应项可删除或改为 `[x]` 并写「见主清单 §…」。  
3. **上游变更**：OpenClaw 弃用某 RPC 时，将本条标 `[-]` 并注明原因与日期。  
4. **验证**：涉及 Gateway 的改动，按 `AGENTS.md` 至少 `pnpm build` + `cargo check`；新增纯函数补 `pnpm test`。

---

## 快速总览（复制用）

| 优先级 | 条目 | 状态 |
|--------|------|------|
| P0 | 0.1 Gateway v4 `deltaText` / `replace` | `[ ]` |
| P0 | 0.2 推荐版本提升到 `2026.5.12` | `[ ]` |
| P0 | 0.3 Rich-only / presentation 回复 | `[ ]` |
| P1 | 1.1 新建 Agent 模板 + 说明字段 | `[ ]` |
| P1 | 1.2 新建定时任务傻瓜式向导 | `[ ]` |
| P1 | 1.3 `cron.get` | `[ ]` |
| P1 | 1.4 Auto-scroll 模式 | `[ ]` |
| P1 | 1.5 技能 Zip 安装闭环 | `[ ]` |
| P1 | 1.6 `parentSessionKey` / `spawn-child` 侧栏树 | `[ ]` |
| P1 | 1.7 `isHeartbeat` 展示 | `[ ]` |
| P1 | 1.8 OpenAI 登录路径文案 | `[ ]` |
| P1 | 1.9 Gemini 旧 id 引导 | `[ ]` |
| P1 | 1.10 `localService` 状态提示 | `[ ]` |
| P2 | 2.1–2.7 见上文 | 多为 `[ ]` |
| P3 | 3.1–3.4 见上文 | 多为 `[ ]` |
