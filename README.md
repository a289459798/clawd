# clawx

clawx 是一个基于 `Tauri + React + TypeScript` 的本地桌面端项目，目标不是再做一个泛化的 AI 面板，而是**把 OpenClaw 变成一个更顺手、更像常规桌面软件的工作台**。

当前项目仍处于原型阶段，但方向已经明确：

> 说明：当前界面已去掉演示性质的 mock 数据，页面只展示本机真实读取到的 OpenClaw 数据；如果本地没有数据，则展示空状态，而不是伪造内容。

- 降低 OpenClaw 日常使用门槛
- 减少频繁切换对话窗口的成本
- 让 `agent / 对话 / model / skill / channel / usage` 这些 OpenClaw 核心对象可视化
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
- 可视化管理模型 provider、模型列表和默认模型
- 可视化查看 skills
- 可视化查看 channel 连接状态与配置入口
- 可视化查看 OpenClaw usage
- 提供一键打开本地 OpenClaw 网页入口

核心定位：

> **clawx = OpenClaw 的桌面工作台 / 管理壳，而不是另一个聊天机器人 UI。**

---

## 3. 当前界面结构

当前版本已经从早期的 dashboard 风格重构为更接近常规桌面软件的结构。

### 左侧一级导航

当前一级导航有 5 个模块：

- **对话**
- **模型**
- **技能**
- **连接**
- **用量**

左下角保留 OpenClaw 入口，可一键打开本地 OpenClaw 网页；当检测到 OpenClaw CLI 有新版本时，会在图标右上角显示“有更新”，弹层内展示当前版本、最新版本和更新按钮。更新动作使用 `openclaw update`。

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

当前优先通过 Gateway `skills.status` 读取状态，并通过 `skills.update` 做启停；本地 snapshot 只作为 Gateway 不可用时的兜底。

### 模型页

模型页用于管理 OpenClaw 的 provider 与模型。

当前交互结构：

- 左侧展示 provider，可搜索、按已配置/未配置/OAuth 过滤，并支持添加自定义 provider。
- 右侧展示选中 provider 下的模型。
- Provider 配置和添加模型分开：
  - Provider 配置包含 API Key、Base URL、OAuth 等连接信息。
  - 添加/修改模型只配置模型名称、别名、是否设为默认等使用信息。
- 未配置 provider 时，模型列表禁用并提示“请先配置 Provider”。
- 已配置 provider 的模型可以修改或设为默认。
- 支持 OAuth 的 provider 显示授权入口，授权流程通过 OpenClaw CLI 在外部可见环境中完成。

数据来源：

- `models.list`：读取已配置模型与完整模型 catalog。
- `models.authStatus`：读取 OAuth 授权状态。
- `config.get` + `config.patch`：保存 provider 配置、模型列表和默认模型。

默认模型写入 OpenClaw 配置，不只保存在 clawx 前端状态。

### 连接页

连接页用于展示 OpenClaw 的 channel / connection 信息。

当前展示内容包括：

- channel 名称
- 当前状态（已连接 / 需检查 / 未启用）
- 配置项位置
- 最近活动
- 打开本地 OpenClaw 页面入口

当前优先通过 Gateway `channels.status` 读取运行状态；WeChat channel 已接入安装、启用、登录和更新检查流程。后续 channel 配置应继续按 channel/schema 分流，不要恢复成统一大表单。

### 用量页

用量页通过 Gateway `sessions.usage` 汇总 OpenClaw 使用情况，当前用于查看输入、输出、缓存读写、成本估算、按 agent/model/session 的拆分。

模型、技能、连接、用量页面都采用“先打开页面，再异步加载数据”的交互方式。耗时的 Gateway RPC、OpenClaw CLI 或 npm 操作应显示局部 loading，不应阻塞整个桌面 UI。

---

## 4. 当前代码状态

当前项目是 **已接入本地 OpenClaw 真实数据、Gateway 发送能力、模型管理、技能/连接/用量页面的桌面原型**。界面结构和核心对话链路已经打通，最近重点转向 OpenClaw 能力对齐、跨平台兼容与可维护性整理。

### 已完成

- Tauri + React + TypeScript 项目骨架
- 左侧导航 / 资源区 / 主工作区布局
- 对话列表与详情页的主界面内切换
- 技能页和连接页基础展示
- 模型页基础管理：provider 配置、OAuth 授权入口、添加/修改模型、设为默认模型
- 用量页基础展示
- 列表页状态、摘要、usage 的准实时增量刷新
- 对话详情页已接入真实发送能力，可直接发消息到现有 session
- 左侧 agent 区已接入真实 `sessions.create`，支持新建对话
- composer 支持停止生成、图片附件、纯图片发送和图文混发
- Gateway chat 事件、消息发送、模型列表等逻辑已从 `App.tsx` 拆入 hooks 和 feature 组件
- `pnpm build` 构建通过

### 尚未完成

- 新建 Agent 的真实写入能力
- agent 创建 / 删除 / 配置修改能力
- 会话状态改为 OpenClaw 明确提供的真实运行态（当前仍为规则推断）

### 已接入的真实数据 / 行为

当前已不再是纯 mock，已接入部分本地 OpenClaw 真实数据：

- 通过 Gateway 读取 `agents.list`、`sessions.list`、`sessions.preview`、`chat.history`
- 通过 Gateway 读取 `models.list`、`models.authStatus`、`skills.status`、`channels.status`、`sessions.usage`
- Gateway 不可用时读取本地 OpenClaw snapshot 作为 fallback
- 通过 `openclaw dashboard --no-open` 获取真实 dashboard URL 并打开

当前已实现：

- 首次启动会先检查本机是否安装 OpenClaw；未安装时不进入主界面，并提供“立即安装”和“我已安装，重新检测”
- “立即安装”会按当前平台打开系统终端并执行 OpenClaw 官方安装入口：
  - macOS / Linux: 先运行 `curl -fsSL https://openclaw.ai/install.sh | bash`，失败时自动回退到 `curl -fsSL https://openclaw.ai/install-cli.sh | bash`
  - Windows: `iwr -useb https://openclaw.ai/install.ps1 | iex`
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
- 应用框架、引导页、信息页、资源侧栏已拆为独立组件：
  - `src/components/AppChrome.tsx`
  - `src/components/BootstrapScreens.tsx`
  - `src/components/InfoPages.tsx`
  - `src/components/ResourceSidebar.tsx`
- 对话共享类型已抽到 `src/types/conversation.ts`，应用/Gateway 类型分别抽到 `src/types/app.ts`、`src/types/gateway.ts`
- 详情页消息状态推导已抽到 `src/lib/conversationDetailState.ts`
- Gateway chat 事件处理已抽到 `src/hooks/useGatewayChat.ts`
- 发送消息、草稿会话转真实 session、错误恢复已抽到 `src/hooks/useMessageSender.ts`
- 模型列表加载已抽到 `src/hooks/useModels.ts`
- 自动滚动已抽到 `src/hooks/useConversationAutoScroll.ts`
- 技能、连接、模型、用量等慢页面已按异步加载优化，页面先打开，数据再加载
- Tauri Gateway 代理中的慢 RPC 已改为 async command + `spawn_blocking`，避免系统级等待光标卡住界面

也就是说，当前更准确的描述是：

> **这是一个产品结构已经明确的桌面原型，不是已经完成的数据驱动成品。**

---

## 5. 核心数据模型设计思路

当前界面已尽量使用 OpenClaw Gateway / 本地 snapshot 的真实数据，以下是前端组织数据时应保持的对象边界。

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

### ModelProvider
表示一个模型提供商或 OpenClaw provider。

建议包含：

- `id`
- `name`
- `configured`
- `auth`
- `baseUrl`
- `models`

### Model
表示 provider 下可用或可添加的模型。

建议包含：

- `id`
- `name`
- `alias`
- `providerId`
- `enabled`
- `isDefault`

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

6. **管理 models / providers**
   - 展示 OpenClaw 支持的 provider 与模型
   - 支持 provider 配置、OAuth 授权、添加自定义模型、设置默认模型
   - 后续可继续接入 schema-driven config、SecretRef、per-agent 默认模型与 fallback chain

7. **打开本地 Web UI**
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
- Rust

Rust 端负责 Tauri 命令桥接、OpenClaw Gateway 代理、文件/目录选择、外部终端安装入口等能力。

### 平台兼容开发规范

clawx 的桌面能力必须兼容：

- macOS
- Windows

Linux 当前保留基础兜底能力，但不是当前主要交付平台，也不能替代 macOS / Windows 的兼容性要求。

平台相关逻辑集中在 Tauri 后端：

- macOS 安装入口通过 Terminal 执行官方 shell 安装脚本
- Windows 安装入口通过 PowerShell 执行官方 PowerShell 安装脚本
- Linux 会尝试常见图形终端执行官方 shell 安装脚本

安装脚本与系统要求以 OpenClaw 官方文档为准：

- https://docs.openclaw.ai/install

更完整的开发约束见根目录 `AGENTS.md`。

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
  - 当前主界面状态编排层
- `src/App.css`
  - 当前整体样式
- `src/components/ModelsPage.tsx`
  - 模型 provider / model 管理页面
- `src/components/ConversationDetail.tsx`
  - 对话详情与消息流展示
- `src/hooks/useGatewayChat.ts`
  - Gateway chat 事件处理
- `src/hooks/useMessageSender.ts`
  - 发送消息、停止生成、错误恢复
- `src-tauri/src/lib.rs`
- Tauri 命令桥接入口
- `src-tauri/src/gateway_proxy.rs`
  - Gateway WebSocket 代理、RPC、事件转发与慢 RPC async command
- `src-tauri/tauri.conf.json`
  - Tauri 应用配置

---

## 10. 本地开发

### 前置要求

通用：

- Node.js 22.14+，推荐 Node 24
- pnpm
- Rust / Cargo

macOS：

- Xcode Command Line Tools
- 系统 Terminal 可用

Windows：

- Windows 10/11
- WebView2 Runtime
- Microsoft C++ Build Tools
- PowerShell 可用

OpenClaw：

- clawx 运行时依赖本机 OpenClaw Gateway
- 推荐先按官方文档完成 OpenClaw 安装与 onboarding
- 开发环境中也可以使用 OpenClaw 源码仓库，但当前 clawx 的安装检测仍以 `openclaw` 命令是否可用为准

安装依赖：

```bash
pnpm install
```

启动桌面开发环境：

```bash
pnpm tauri dev
```

仅启动前端开发环境：

```bash
pnpm dev
```

说明：仅前端模式适合看界面；涉及 Gateway、文件、安装入口、目录选择等能力时，需要运行 Tauri 桌面模式。

仅构建前端：

```bash
pnpm build
```

检查 Tauri / Rust 端：

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

### OpenClaw 安装引导

如果启动时未检测到 OpenClaw，clawx 会停在引导页：

- 点击“立即安装”：打开系统终端并运行对应平台的官方安装脚本
- macOS / Linux 的标准安装器如果遇到全局 npm 权限问题，会自动回退到 local-prefix 安装器
- local-prefix 安装后，`openclaw` 可能位于 `~/.openclaw/bin/openclaw`。clawx 会自动识别这个路径；如果希望在普通终端直接输入 `openclaw`，需要把 `~/.openclaw/bin` 加入 PATH
- 安装完成后：回到 clawx 点击“我已安装，重新检测”
- 检测通过后：继续进行 Gateway 绑定和连接测试

当前安装入口只是启动官方安装流程，不会静默安装，也不会在后台隐藏安装输出。这样用户可以看到 OpenClaw onboarding 的提示、授权和错误信息。

---

## 11. 当前阶段最重要的下一步

### 第一优先级
1. **模型管理继续补齐** — SecretRef、provider schema、per-agent 默认模型、fallback chain
2. **把上传从“图片可用”继续补到“文件能力完整”**
3. **进一步压缩 App.tsx** — 把剩余消息状态/列表编排继续外移

### 第二优先级
4. 接入音频发送
5. 进一步直接消费更完整的 Gateway RPC / 标准事件流
6. 做详情页和列表页的进一步视觉收敛
7. 给模型、连接、消息合并、usage selector 补更多测试

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

5. **Gateway 是第一来源，snapshot 是 fallback**
   - 改造时请优先把数据层和视图层分开
   - 不要把 OpenClaw 配置、session、skill、channel、model 解析逻辑复制成 clawx 的第二套实现

6. **慢操作必须异步**
   - 页面先打开，再加载数据
   - 按钮、卡片、行级别显示 loading
   - Rust/Tauri 阻塞调用用 async command + `spawn_blocking`

---

## 13. 当前一句话总结

> clawx 是一个面向 OpenClaw 的本地桌面工作台原型，重点解决多 agent / 多对话切换、模型配置、skill/channel 管理和 usage 查看等日常工作流问题。

## 14. 最近开发日志（2026-04-21）

### 2026-04-21 上午至下午
- 对话详情页接入真实消息发送与流式更新
- 消息级模型展示与默认值逻辑
- 消息 footer 对齐 webchat 用法条（`↑输出 ↓输入 R缓存 · 模型 · 时间`）
- 连续工具调用折叠为工具组，解决工具刷屏
- 工具组二级展开：先看列表，再点单个看详情
- streaming 中工具组默认展开，完成后默认收起
- Gateway 代理发送路径打通
