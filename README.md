# clawx

clawx 是一个基于 `Tauri + React + TypeScript` 的本地桌面端项目，目标不是再做一个泛化的 AI 面板，而是**把 OpenClaw 变成一个更顺手、更像常规桌面软件的工作台**。

当前项目仍处于原型阶段，但方向已经明确：

> 说明：当前界面已去掉演示性质的 mock 数据，页面只展示本机真实读取到的 OpenClaw 数据；如果本地没有数据，则展示空状态，而不是伪造内容。

- 降低 OpenClaw 日常使用门槛
- 减少频繁切换对话窗口的成本
- 让 `agent / 对话 / skill / channel` 这些 OpenClaw 核心对象可视化
- 为后续的本地 adapter 接入预留结构

---

## 1. 项目背景

当前 OpenClaw 本身已经具备很强的能力，但在桌面端高频使用时，有几个体验问题比较明显：

1. **切换对话窗口不够顺手**
   - 多个会话并行时，需要频繁切换
   - 很难像常规桌面软件一样总览当前工作状态

2. **agent 和对话的关系不够直观**
   - OpenClaw 可以配置多个 agent
   - 每个 agent 下又可能有多个对话 / session
   - 目前这种结构没有很好地体现在界面里

3. **skills 和 channel 配置分散**
   - skill 列表、channel 连接配置、统计信息分散在不同地方
   - 不利于集中管理和快速查看

所以 clawx 的目标不是替代 OpenClaw，而是做一个 **OpenClaw 的本地桌面工作台**。

---

## 2. 产品目标

clawx 想解决的是以下几类需求：

- 把 OpenClaw 的日常操作组织成更清晰的桌面工作流
- 在一个界面里管理多个 agent 与多个对话
- 让工作中的对话自动排到前面
- 让已关闭的对话不占据主工作区，但仍然保留在左侧资源列表中，方便重新打开
- 可视化查看 skills
- 可视化查看 channel 连接状态与配置入口
- 提供一键打开本地 OpenClaw 网页入口

核心定位：

> **clawx = OpenClaw 的桌面工作台 / 管理壳，而不是另一个聊天机器人 UI。**

---

## 3. 当前界面结构

当前版本已经从早期的 dashboard 风格重构为更接近常规桌面软件的结构。

### 左侧一级导航

当前一级导航有 3 个模块：

- **对话**
- **技能**
- **连接**

左下角保留一个入口，可一键打开本地 OpenClaw 网页。

### 对话页

对话页是当前最核心的页面。

#### 左侧资源区
展示 `agent + 对话` 的树形关系：

- Agent
  - 对话 A
  - 对话 B
  - 对话 C

每个 agent 下的会话列表当前展示：

- 对话标题
- Token 数
- 状态徽章

#### 主工作区列表
主工作区默认展示当前 `visible = true` 的对话卡片列表。

每张卡片当前展示：

- 对话标题
- 所属 agent
- 模型名
- 该会话累计 token 用量
- 状态徽章
- 最后一条 assistant 回复摘要（优先）
- 最近活跃时间
- 放大图标（进入详情页）
- 关闭图标（从主工作区隐藏）

说明：
- 列表里**不再展示工作目录**
- token 以紧凑格式显示，例如 `19.4K`
- 状态当前按会话最近消息与最后活跃时间推断：
  - 最新消息为 user，且 30 分钟内有交互 → `进行中`
  - 最新消息为 assistant / toolResult，且 30 分钟内有交互 → `已完成`
  - 超过 30 分钟无交互 → `空闲中`
- 排序顺序为：`进行中 → 已完成 → 空闲中`

#### 对话详情页
点击卡片或放大图标后，当前会进入**主界面内的对话详情页**，不是独立弹窗。

详情页当前展示：

- 对话标题
- agent / model
- 工作目录
- 最近活跃时间
- token 拆分统计（总量、输入、输出、缓存读取、缓存写入）
- 最近上下文预览
- 发送区占位

### 当前交互规则

- 对话默认可在主工作区显示或隐藏
- **隐藏** 只影响主工作区展示，不会从左侧资源树删除
- 左侧点击隐藏的对话，可以重新加入工作区
- 点击卡片正文或放大图标，进入当前对话详情页
- 点击详情页“返回列表”，回到对话卡片列表

### 技能页

技能页用于展示 OpenClaw 的 skill 信息。

当前展示内容包括：

- skill 名称
- 简短用途
- skill 文件路径
- 是否启用

后续会进一步接入真实 skill 列表和 `SKILL.md` 摘要。

### 连接页

连接页用于展示 OpenClaw 的 channel / connection 信息。

当前展示内容包括：

- channel 名称
- 当前状态（已连接 / 需检查 / 未启用）
- 配置项位置
- 最近活动
- 打开本地 OpenClaw 页面入口

后续会接入真实 channel 配置与运行状态。

---

## 4. 当前代码状态

当前项目仍是 **原型 + mock 数据驱动**，重点在验证信息架构和界面交互，而不是完整功能实现。

### 已完成

- Tauri + React + TypeScript 项目骨架
- 左侧导航 / 资源区 / 主工作区布局
- 对话列表与详情页的主界面内切换
- 技能页和连接页基础展示
- 列表页状态、摘要、usage 的准实时增量刷新
- 对话详情页已接入真实发送能力，可直接发消息到现有 session
- 构建通过

### 尚未完成

- 新建 Agent 的真实写入能力
- agent 创建 / 删除 / 配置修改能力
- 会话状态改为 OpenClaw 明确提供的真实运行态（当前仍为规则推断）

### 已接入的真实数据 / 行为

当前已不再是纯 mock，已接入部分本地 OpenClaw 真实数据：

- 读取 `~/.openclaw/openclaw.json`
- 读取 `~/.openclaw/agents/<agentId>/sessions/sessions.json`
- 读取 `~/Workspace/nodejs/clawdbot/skills`
- 读取 `~/.agents/skills`
- 通过 `openclaw dashboard --no-open` 获取真实 dashboard URL 并打开

当前已实现：

- 首次启动会先检查本机是否安装 OpenClaw；未安装时不进入主界面，并提示需先安装
- 若已安装但 clawx 尚未绑定，会先征得用户同意，再把所需的 `gateway.controlUi.allowedOrigins` 配置写入 `~/.openclaw/openclaw.json`
- 绑定完成后才进入主界面，避免出现“看得到 UI 但 Gateway 一直不可用”的假可用状态
- 真实 agent 列表读取
- 真实 channel / connection 列表读取
- 真实 skill 列表读取
- 真实 session 元数据读取
- 从 session jsonl 中提取最后一条 assistant 回复摘要
- 从 session jsonl 中累计 token 用量
- 详情页展示 token 拆分统计
- 通过 Tauri 后端增量监听 session transcript 追加内容，实时刷新列表页状态、摘要和 usage
- 详情页通过 Tauri Rust 后端代理调用 Gateway `chat.history` 拉取历史
- 详情页通过 Tauri Rust 后端代理调用 Gateway `chat.send` 发送消息
- 详情页通过 Tauri Rust 后端代理调用 Gateway `chat.abort` 停止生成
- 左侧 agent 区已接入真实 `sessions.create`，支持新建对话
- 发送时会下发 `sessionKey / message / idempotencyKey / model / thinking / attachments / deliver=false / inputProvenance.kind=external_user`
- clawx 作为桌面端来源标识通过代理层请求头透传
- 详情页会读取 assistant 消息中的 `model / provider / api` 并在消息级展示
- 模型默认值逻辑已接入：已有对话优先取上一次 assistant 使用的模型，新建对话优先取 agent 默认模型，再回退全局默认模型
- 每次发送都会显式携带当前选中的模型参数
- 发送后会先本地插入 user / assistant 占位，再用 chat delta/final 事件更新回复内容
- delta 阶段会持续拼接流式文本，并兼容工具 / 图片等结构化消息片段
- final 完成后主动重新拉取历史，补齐 usage 数据到消息 footer
- 消息 footer 仅挂在最后一条 assistant 消息底部，显示类 webchat 用法条：`↑输出 ↓输入 R缓存 · 模型 · 时间`
- token 使用紧凑格式（例如 `21.7K`）
- 连续纯工具消息（多条连续消息）会折叠为一个工具组，不再刷屏
- 工具组支持二级展开：先看工具列表，再点看单个工具的参数和结果
- streaming 中默认展开工具组，完成后默认收起
- composer 已拆为独立组件 `src/components/ConversationComposer.tsx`
- 详情页主体已拆为独立组件 `src/components/ConversationDetail.tsx`
- 列表容器与卡片已拆为独立组件 `src/components/ConversationList.tsx`、`src/components/ConversationCard.tsx`
- 对话共享类型已抽到 `src/types/conversation.ts`
- 详情页消息状态推导已抽到 `src/lib/conversationDetailState.ts`

也就是说，当前更准确的描述是：

> **这是一个产品结构已经明确的桌面原型，不是已经完成的数据驱动成品。**

---

## 5. 核心数据模型设计思路

虽然当前还是 mock 数据，但界面结构已经在按未来的数据模型组织。

### Agent
表示一个 OpenClaw agent，未来会和真实配置关联。

建议包含：

- `id`
- `name`
- `status`
- `model`
- `mdFile`
- `configPath`
- `summary`
- `conversations`

### Conversation
表示某个 agent 下的一个对话 / session。

建议包含：

- `id`
- `title`
- `status`
- `lastMessage`
- `lastTime`
- `tokens`
- `model`
- `workspace`
- `visible`
- `pinned`

其中：

- `visible` 用来控制是否出现在主工作区
- `pinned` 可用于控制优先级或重要对话

### Skill
建议包含：

- `id`
- `name`
- `summary`
- `location`
- `enabled`

### ChannelConnection
建议包含：

- `id`
- `name`
- `status`
- `detail`
- `config`
- `activity`

---

## 6. 为什么当前不直接做“炫酷 dashboard”

项目早期尝试过偏 dashboard 的方案，但已经确认不适合作为最终方向。

原因：

- dashboard 更适合展示，不适合高频工作流
- 大标题、英文标题、超大卡片会影响长期使用
- OpenClaw 的核心问题不是“缺一个展示页”，而是“缺一个顺手的桌面管理界面”

所以现在的设计原则是：

- 少大标题
- 少英语装饰性文案
- 更接近日常软件
- 优先强调结构、可管理性和工作流

---

## 7. 和 OpenClaw 的关系

clawx 的长期目标是做 OpenClaw 的本地桌面前端，而不是重新发明一套独立系统。

未来对接方向包括：

1. **读取 agent 配置**
   - 从 OpenClaw 配置中读取已存在的 agent
   - 展示对应的 md 文件、配置路径、权限等信息

2. **支持创建 agent**
   - 新建 agent 时，自动写入相应的 `xxx.md`
   - 同时修改 OpenClaw 配置文件
   - 包括 agent 目录、权限、skill、工作目录等配置

3. **读取 session / conversation**
   - 读取已有对话
   - 展示最近消息、运行状态、最近活跃时间
   - 支持在工作区中显示 / 隐藏

4. **读取 skills**
   - 展示所有 OpenClaw skills
   - 后续可考虑支持启用状态、说明摘要、依赖提示

5. **读取 channels / connections**
   - 展示所有 channel 配置
   - 展示启用状态、连接状态和错误信息

6. **打开本地 Web UI**
   - clawx 提供桌面端工作流
   - 本地 OpenClaw 网页保留为辅助入口

---

## 8. 技术栈

### 前端
- React 19
- TypeScript
- Vite 7

### 桌面端
- Tauri 2
- Rust（当前仍基本是壳层）

当前 Rust 端仍然很轻，后续需要承担更多 adapter / invoke bridge 的工作。

---

## 9. 目录说明

### 主要目录

- `src/`
  - 前端页面与交互逻辑
- `src-tauri/`
  - Tauri 桌面端壳层
- `README.md`
  - 项目说明

### 当前重点文件

- `src/App.tsx`
  - 当前主界面原型
- `src/App.css`
  - 当前整体样式
- `src-tauri/src/lib.rs`
  - Tauri 命令桥接入口，后续需要扩展
- `src-tauri/tauri.conf.json`
  - Tauri 应用配置

---

## 10. 本地开发

安装依赖：

```bash
pnpm install
```

启动前端开发环境：

```bash
pnpm tauri dev
```

仅构建前端：

```bash
pnpm build
```

检查 Tauri / Rust 端：

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

---

## 11. 当前阶段最重要的下一步

### 第一优先级
1. **footer 对齐 webchat 用法条** — 确认 `↑/↓/R/0%/ctx` 与 usage 字段的精确对应关系
2. **把上传从“图片可用”继续补到“文件能力完整”**
3. **进一步压缩 App.tsx** — 把剩余消息状态/列表编排继续外移

### 第二优先级
4. 接入音频发送
5. 在 OpenClaw CLI 配置恢复后，进一步直接消费更完整的 Gateway RPC / 标准事件流
6. 做详情页和列表页的进一步视觉收敛
7. 拆分 `App.tsx` — 拆为组件 / feature 模块

### 第三优先级
8. 新建 Agent / Agent 配置编辑
9. Skill 启停与安装
10. Connection 配置编辑与刷新
11. 历史消息分页 / 增量加载

---

## 12. 给后续 AI / 开发者的说明

如果你是后续接手这个项目的 AI 或开发者，请优先理解以下几点：

1. **这个项目的目标不是炫酷，而是顺手**
   - 不要轻易改回 dashboard 风格
   - 不要重新加大标题、英文副标题、品牌展示块

2. **对话页是核心页面**
   - `agent + conversation` 的关系必须保留
   - 工作区只展示当前打开的对话
   - 左侧资源树保留全部对话

3. **隐藏对话不是删除对话**
   - 隐藏只影响工作区显示
   - 左侧仍然要能重新打开

4. **clawx 是 OpenClaw 的工作台，不是独立聊天工具**
   - UI 设计应围绕 OpenClaw 的真实对象和配置组织
   - 不要把它做成单纯的大模型聊天壳

5. **当前很多数据仍是 mock**
   - 改造时请优先把数据层和视图层分开
   - 后续应尽快替换为真实 adapter

---

## 13. 当前一句话总结

> clawx 是一个面向 OpenClaw 的本地桌面工作台原型，重点解决多 agent / 多对话切换麻烦的问题，并逐步把 agent、skill、channel 等核心对象组织成一个更顺手的桌面软件界面。

## 14. 最近开发日志（2026-04-21）

### 2026-04-21 上午至下午
- 对话详情页接入真实消息发送与流式更新
- 消息级模型展示与默认值逻辑
- 消息 footer 对齐 webchat 用法条（`↑输出 ↓输入 R缓存 · 模型 · 时间`）
- 连续工具调用折叠为工具组，解决工具刷屏
- 工具组二级展开：先看列表，再点单个看详情
- streaming 中工具组默认展开，完成后默认收起
- Gateway 代理发送路径打通
