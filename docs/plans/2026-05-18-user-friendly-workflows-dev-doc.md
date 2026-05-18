# 普通用户友好工作流开发文档

> 创建日期：2026-05-18  
> 适用范围：Agent 创建、定时任务创建、OpenClaw 状态弹层，以及后续所有面向普通用户的配置弹层。  
> 背景：ClawKit 面向普通用户使用，不应要求用户先理解 OpenClaw CLI、Gateway RPC、cron 表达式或配置文件结构。

---

## 设计目标

ClawKit 的主路径应让用户用自然语言完成配置：

- 新建 Agent：先选择模板或填写少量信息，再按需修改 Agent 说明。
- 新建定时任务：先回答“让 AI 做什么、由谁做、什么时候做”，高级配置默认收起。
- OpenClaw 状态：先告诉用户是否可用、下一步点什么；版本、路径、诊断信息放到高级区。
- 所有弹层：头部标题固定，底部操作栏固定，中间内容滚动，避免长表单把关键按钮挤出屏幕。

开发时把“普通用户能完成任务”作为第一验收标准；高级能力仍保留，但不压在第一屏主路径上。

---

## 弹层通用规范

所有配置类弹层应采用三段式结构：

```tsx
<div className="modal-backdrop">
  <form className="feature-modal">
    <div className="feature-modal-head">...</div>
    <div className="feature-modal-body">...</div>
    <div className="feature-modal-actions">...</div>
  </form>
</div>
```

实现要求：

- `*-head` 和 `*-actions` 使用 `flex: 0 0 auto`，保持固定。
- `*-body` 使用 `min-height: 0; overflow: auto;`，只让正文滚动。
- 弹层本体使用 `max-height: calc(100vh - 40px)` 或同类约束，移动窄屏也不能溢出。
- 底部按钮栏应始终可见，主按钮在右侧，取消/返回在左侧或主按钮左侧。
- 新增弹层不再使用右侧抽屉模式；除非未来有明确产品要求，否则配置编辑统一使用居中弹层。
- 深色/浅色模式都必须复用现有 token：`var(--panel)`、`var(--border)`、`var(--control-bg)`、`var(--text)`、`var(--muted)` 等。

当前相关实现：

- `src/components/AgentCreateDialog.tsx`
- `src/components/CronPage.tsx`
- `src/components/OpenClawInfoModal.tsx`
- `src/App.css`

---

## Agent 创建工作流

### 用户路径

1. 用户点击新建 Agent。
2. 弹层顶部展示常用模板。
3. 用户点击模板后自动填充：
   - Agent ID
   - 名称
   - 工作目录建议
   - Agent 说明
   - 可选 emoji
4. 用户可以继续手动修改。
5. 创建成功后，Agent 说明写入 OpenClaw 支持的 agent identity/files 入口。

### 实现边界

- 模板数据放在 `src/lib/agentTemplates.ts`，不要把模板内容写死在 JSX。
- 模板文案必须通过 i18n key 读取，至少维护 `zh-CN` 和 `en-US`。
- 创建 Agent 仍走 Gateway/Tauri 现有 create 路径。
- 不要向 `agents.create` 塞 Gateway schema 不接受的字段。
- 如果 OpenClaw create/update schema 不支持说明字段，应创建成功后通过 agent files API 写入说明文件。

### 数据落地

当前 Agent 说明文件名：

```ts
AGENT_DESCRIPTION_FILE = "AGENTS.md"
```

创建流程：

1. 调用 `gateway_agents_create` 创建 Agent。
2. 如有名称或 emoji，调用 `gateway_agents_update`。
3. 如用户填写 Agent 说明，调用 `gateway_agents_files_set` 写入 `AGENTS.md`。

### 验收点

- 不选模板也能创建。
- 选模板后字段自动填充，且每个字段都能覆盖。
- 创建失败时保留用户已填写内容。
- Agent ID 仍按现有校验规则处理。
- Agent 说明不应丢失换行和 Markdown 结构。
- 深色/浅色模式下模板卡片、输入框、错误提示均可读。

---

## 定时任务创建工作流

### 用户路径

新建任务使用三步向导：

1. **任务**：任务名称、任务说明、让 AI 做什么。
2. **时间**：由哪个 Agent 执行、什么时候执行。
3. **确认**：展示自然语言预览，高级配置折叠。

编辑已有任务时可以一次展示完整表单，避免高级用户修改旧任务时来回切步骤。

### 主路径文案

主路径使用普通用户能理解的话：

- “这个任务是做什么的？”
- “让 AI 做什么”
- “由谁来做”
- “什么时候执行？”
- “不知道选哪个就保持默认”

避免把以下术语放在默认主路径：

- cron
- RRULE
- Gateway payload
- delivery mode
- isolated session
- webhook

这些字段可保留在“高级选项”或“结果投递”折叠区。

### 时间选择

默认提供卡片：

- 每天
- 每周
- 每隔一段时间
- 指定时间

卡片转换为 Gateway 接受的 schedule payload：

- 每天：`cronExpr = "0 9 * * *"`
- 每周：`cronExpr = "0 9 * * 1"`
- 每隔：`everyMinutes`
- 指定时间：`atLocal`

保存前仍由现有转换逻辑生成 `cron.add` / `cron.update` payload，不能绕过 Gateway。

### 模板

模板数据放在 `src/lib/cronTemplates.ts`。

模板应包含：

- `id`
- `emoji`
- `nameKey`
- `summaryKey`
- `payloadKey`
- 默认 schedule 建议

模板只负责填表，不直接创建任务。用户套用后仍可修改每个字段。

### 自然语言预览

确认页需要展示类似：

```text
每天 09:00，由 默认 Agent 执行：整理今日预约
```

预览由前端根据 draft 生成，仅用于帮助用户理解，不作为 canonical 数据来源。

### 高级配置

以下内容放到折叠区：

- 启用/禁用任务
- Cron 表达式
- 时区
- 结果投递方式
- 通道和目标
- Webhook URL

如果已有任务无法映射到简单卡片，不要丢失原始配置，应让用户在高级区继续编辑。

### 验收点

- 普通用户不接触 cron 也能完成创建。
- 第 1 步未填写任务名称或任务内容时，不允许进入下一步。
- 第 2 步默认使用默认 Agent。
- 第 3 步能看到自然语言预览。
- 高级字段修改后保存不丢失。
- `cron.list` / `cron.runs` / 保存后的 reconciliation 仍以 Gateway canonical 数据为准。

---

## OpenClaw 状态弹层

### 用户路径

OpenClaw 弹层优先回答三个问题：

1. 当前 OpenClaw 是否可用？
2. 如果不可用，下一步应该点什么？
3. 当前版本是否建议升级？

高级诊断放在折叠区，包括：

- CLI 路径
- 当前版本
- 最新版本
- Gateway 状态
- 重启哨兵
- 渲染诊断
- 原始错误摘要

### 版本门槛

推荐版本和功能最低版本必须分开：

- 推荐版本用于升级提示。
- 功能最低版本用于禁用/启用某个入口。

低版本策略：

- 不阻断整个应用。
- 只禁用依赖新版 OpenClaw 的具体功能。
- 给出普通用户能理解的提示，例如“升级 OpenClaw 后可使用此功能”。
- 调试详情可以保留 schema/RPC 错误，但要放到展开区。

---

## i18n 要求

所有用户可见文案必须走 i18n key，包括：

- 标题
- 按钮
- 表单 label
- placeholder
- 模板名称
- 模板说明
- 默认任务内容
- 自然语言预览
- 错误提示
- `title`
- `aria-label`

新增 key 时至少同步：

- `src/locales/zh-CN.ts`
- `src/locales/en-US.ts`

模板内容也属于用户可见文案，不允许直接硬编码在组件里。

---

## 代码组织

推荐拆分：

- 组件：`src/components/`
- 模板数据：`src/lib/*Templates.ts`
- 转换/预览纯函数：`src/lib/`
- Gateway/Tauri 桥接：已有 command 与 `gateway_proxy.rs`
- 业务状态：优先放 hook 或页面组件内，避免继续堆到 `App.tsx`

`App.tsx` 只保留装配和必要 state wiring，不应继续承载长 JSX 或复杂业务逻辑。

---

## 验证清单

涉及这些工作流时至少运行：

```bash
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
pnpm test
```

手动回归建议：

- 新建 Agent：空白创建。
- 新建 Agent：选择模板后创建，并确认说明文件存在。
- 新建定时任务：从模板创建。
- 新建定时任务：手动填写三步创建。
- 编辑已有定时任务：高级字段不丢失。
- OpenClaw 未连接时：弹层给出可操作下一步。
- OpenClaw 版本过低时：只禁用相关功能，并提示升级。
- 深色/浅色主题各检查一次。
- 窄屏或低高度窗口下，弹层底部按钮栏始终可见。

---

## 后续可扩展方向

- 行业模板包：例如宠物医院、个人效率、客服、研发运维，但不能把某个行业做成唯一入口。
- 模板管理：允许用户保存自己的 Agent 模板或定时任务模板。
- 更细的能力门槛：集中维护 OpenClaw feature capability map，页面只消费 helper 结果。
- 更完整的可访问性：步骤切换键盘导航、错误焦点定位、滚动区焦点管理。
