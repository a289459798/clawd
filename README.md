# clawx

clawx 是一个基于 `Tauri + React + TypeScript` 的本地桌面端项目，目标不是再做一个泛化的 AI 面板，而是**把 OpenClaw 变成一个更顺手、更像常规桌面软件的工作台**。

当前项目仍处于原型阶段，但方向已经明确：

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

### 顶部栏

顶部栏负责放置全局能力：

- 搜索入口（未来可接全局搜索）
- 当前会话数
- 今日 token 统计
- 打开本地 OpenClaw 网页按钮
- 设置入口

### 左侧一级导航

当前一级导航有 3 个模块：

- **对话**
- **技能**
- **连接**

后续如果需要，可以在不破坏整体结构的前提下继续扩展。

### 对话页

对话页是当前最核心的页面。

#### 左侧资源区
展示 `agent + 对话` 的树形关系：

- Agent
  - 对话 A
  - 对话 B
  - 对话 C

每个 agent 同时展示：

- 当前状态
- 使用模型
- 对应的 md 文件
- 对应的配置路径
- 简短职责说明

#### 中间主工作区
工作区展示所有当前处于 `visible = true` 的对话。

默认形态是缩略卡片，只展示：

- 对话标题
- 所属 agent
- 状态
- 最后一条消息摘要
- 工作目录
- token 数
- 最近活跃时间

点击某个卡片后会展开，展示更完整的上下文区域与输入区域占位。

#### 当前交互规则

- 对话默认可在工作区显示或隐藏
- **隐藏** 只影响主工作区展示，不会从左侧资源树删除
- 左侧点击隐藏的对话，可以重新加入工作区
- 进行中的对话优先排在前面
- 当前展开的对话会显示更多内容

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
- 常规桌面软件风格的布局结构
- 顶部栏 / 左侧导航 / 资源区 / 主工作区
- 对话页基础交互骨架
- 技能页和连接页占位结构
- 构建通过

### 尚未完成

- 与 session 真实消息流进一步深度对接
- 新建对话 / 新建 Agent 的真实写入能力
- agent 创建 / 删除 / 配置修改能力
- 更多运行态判断（进行中 / 空闲 / 已完成）

### 已接入的真实数据 / 行为

当前已不再是纯 mock，已接入部分本地 OpenClaw 真实数据：

- 读取 `~/.openclaw/openclaw.json`
- 读取 `~/.openclaw/agents/<agentId>/sessions/sessions.json`
- 读取 `~/Workspace/nodejs/clawdbot/skills`
- 读取 `~/.agents/skills`
- 通过 `openclaw dashboard --no-open` 获取真实 dashboard URL 并打开

当前已实现：

- 真实 agent 列表读取
- 真实 channel / connection 列表读取
- 真实 skill 列表读取
- 真实 session 元数据读取
- 从 session jsonl 中提取最后一条消息摘要（第一版）

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
把当前单文件原型逐步拆分为可维护结构，例如：

- `components/Topbar`
- `components/PrimaryNav`
- `features/conversations`
- `features/skills`
- `features/connections`
- `types/`
- `mock/`

### 第二优先级
接入真实 OpenClaw 数据层，形成最小闭环：

- 真实 agent 列表
- 真实 conversation 列表
- 真实 skills 列表
- 真实 connection 配置

### 第三优先级
把顶部的“打开网页”接成真实能力。

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
