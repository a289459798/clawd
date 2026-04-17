# clawx 项目状态文档

> 最后更新：2026-04-17 17:50 GMT+8
> 本文档用于记录项目当前状态，方便后续 AI 或开发者快速接手继续工作。

---

## 一、项目说明

### 1.1 项目定位

**clawx** 是一个基于 `Tauri + React + TypeScript` 的本地桌面端项目，目标是**把 OpenClaw 变成一个更顺手、更像常规桌面软件的工作台**。

核心定位：
> **clawx = OpenClaw 的桌面工作台 / 管理壳，而不是另一个聊天机器人 UI。**

### 1.2 解决的问题

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

### 1.3 产品目标

- 把 OpenClaw 的日常操作组织成更清晰的桌面工作流
- 在一个界面里管理多个 agent 与多个对话
- 让工作中的对话自动排到前面
- 让已关闭的对话不占据主工作区，但仍然保留在左侧资源列表中
- 可视化查看 skills
- 可视化查看 channel 连接状态与配置入口
- 提供一键打开本地 OpenClaw 网页入口

### 1.4 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 19 |
| 语言 | TypeScript |
| 构建工具 | Vite 7 |
| 桌面端 | Tauri 2 |
| Rust | Tauri 命令桥接 |

### 1.5 目录结构

```
/Users/zhangzy/Workspace/clawx/
├── src/                      # 前端代码
│   ├── App.tsx              # 主界面入口
│   ├── App.css              # 全局样式
│   ├── main.tsx             # React 入口
│   └── ...
├── src-tauri/               # Tauri 后端
│   ├── src/
│   │   └── lib.rs          # Tauri 命令桥接
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## 二、已完成的工作

### 2.1 基础架构

- ✅ Tauri + React + TypeScript 项目骨架搭建
- ✅ 常规桌面软件风格的布局结构
- ✅ 顶部栏 / 左侧导航 / 资源区 / 主工作区
- ✅ 构建流程通过（pnpm build + cargo check）

### 2.2 界面结构

#### 左侧导航
- ✅ 三个导航模块：对话、技能、连接
- ✅ 导航状态管理（activeNav）
- ✅ 底部操作区（打开本地 OpenClaw 按钮）

#### 对话页
- ✅ 左侧资源区展示 agent + 对话树形关系
- ✅ Agent 信息展示（状态、模型、配置文件路径、职责说明）
- ✅ 对话树展示（标题、状态、token 数）
- ✅ 新建对话按钮入口（每个 agent 下）
- ✅ 对话可见性切换（显示/隐藏）
- ✅ 对话展开/收起交互

#### 主工作区（对话详情）
- ✅ 单会话聚焦展示模式
- ✅ 历史消息预览（从真实 session jsonl 读取）
- ✅ 消息按 role 区分展示（User / Assistant / System）
- ✅ 对话元信息展示（工作目录、模型、Token 数、最后活跃时间）
- ✅ 发送消息输入框（位于底部）
- ✅ 文件附件入口（左下角）
- ✅ 发送按钮（右下角）
- ✅ 消息发送后本地 UI 更新

#### 技能页
- ✅ Skill 列表展示
- ✅ Skill 信息：名称、摘要、文件路径、启用状态

#### 连接页
- ✅ Channel/Connection 列表展示
- ✅ 连接状态：已连接 / 需检查 / 未启用
- ✅ 配置项位置和最近活动信息

### 2.3 真实数据接入（Tauri 端）

#### 已实现的 Tauri 命令

| 命令 | 功能 | 状态 |
|------|------|------|
| `resolve_dashboard_url` | 调用 `openclaw dashboard --no-open` 获取真实 URL 并打开 | ✅ 完成 |
| `load_openclaw_snapshot` | 读取本地 OpenClaw 配置和状态快照 | ✅ 完成 |

#### 已接入的真实数据源

| 数据源 | 路径 | 状态 |
|--------|------|------|
| OpenClaw 主配置 | `~/.openclaw/openclaw.json` | ✅ 已读取 |
| Agent 列表 | 从主配置解析 | ✅ 已读取 |
| Session 元数据 | `~/.openclaw/agents/<agentId>/sessions/sessions.json` | ✅ 已读取 |
| Session 消息预览 | `~/.openclaw/agents/<agentId>/sessions/*.jsonl` | ✅ 已读取（最后消息 + 最近 12 条） |
| Skills 列表 | `~/Workspace/nodejs/clawdbot/skills` + `~/.agents/skills` | ✅ 已读取 |
| Channels 列表 | 从主配置解析 | ✅ 已读取 |

#### load_openclaw_snapshot 返回结构

```typescript
{
  agents: Array<{
    id: string;
    name: string;
    workspace?: string;
    model?: string;
    agent_dir?: string;
  }>;
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
  connections: Array<{
    id: string;
    name: string;
    enabled: boolean;
  }>;
  skills: Array<{
    id: string;
    name: string;
    location: string;
  }>;
}
```

### 2.4 前端状态管理

- ✅ agents 状态（从 mock 逐步切换到真实数据）
- ✅ skills 状态（从 fallback 切换到真实数据）
- ✅ connections 状态（从 fallback 切换到真实数据）
- ✅ expandedConversationId（当前展开的对话）
- ✅ showResourceSidebar（左侧资源区展开/收起）
- ✅ composerText（输入框文本）
- ✅ selectedFiles（附件列表）
- ✅ chatSearch（对话搜索关键词）
- ✅ activeConversation（当前选中的会话）

### 2.5 交互功能

- ✅ 对话可见性切换（在工作区显示/隐藏）
- ✅ 对话展开/收起
- ✅ 左侧 Agent 树点击选中对话
- ✅ 文本消息发送（本地 UI 更新）
- ✅ 文件附件添加（mock）
- ✅ 对话搜索（按标题、摘要、历史消息过滤）

### 2.6 样式系统

- ✅ 深色主题
- ✅ 响应式布局（三栏：导航 92px + 资源区 320px + 工作区自适应）
- ✅ 资源区展开/收起（320px ↔ 44px）
- ✅ 卡片样式、按钮样式、输入框样式
- ✅ 消息气泡样式（User / Assistant / System 区分）
- ✅ 状态徽章（进行中 / 空闲 / 已完成）

---

## 三、未完成的工作

### 3.1 高优先级（核心功能）

#### 3.1.1 真实消息发送
- ❌ 文本消息未接入真实 `chat.send`（目前仅本地 UI 更新）
- ❌ 文件上传未实现（目前仅 mock 附件列表）
- ❌ 语音功能已移除（按用户要求）

**需要对接的 OpenClaw 能力：**
- Gateway WebSocket 连接
- `chat.send` RPC 调用
- 文件上传流程
- 实时消息流接收

#### 3.1.2 真实历史拉取
- ❌ 当前历史消息来自本地 jsonl 文件预览
- ❌ 未接入真实 `chat.history`
- ❌ 未实现增量加载/分页

**需要对接的 OpenClaw 能力：**
- `chat.history` RPC 调用
- 消息标准化处理（去除指令标签、tool-call XML 等）

#### 3.1.3 新建对话
- ❌ 左侧"新建对话"按钮未实现真实功能
- ❌ 未接入 `sessions.create` 或 `/new` 命令

**需要对接的 OpenClaw 能力：**
- `sessions.create` RPC
- 或 `sessions_send` 到主会话执行 `/new`

### 3.2 中优先级（体验优化）

#### 3.2.1 实时状态同步
- ❌ 对话状态（working/idle/completed）目前基于更新时间推断
- ❌ 未接入真实运行状态
- ❌ Token 统计目前是占位符

#### 3.2.2 Agent 管理
- ❌ 新建 Agent 未实现
- ❌ Agent 配置编辑未实现
- ❌ Agent 删除未实现

#### 3.2.3 Skill 管理
- ❌ Skill 启用/禁用切换未实现
- ❌ Skill 详情查看未实现
- ❌ Skill 安装未实现

#### 3.2.4 Connection 管理
- ❌ Connection 配置编辑未实现
- ❌ Connection 状态刷新未实现
- ❌ QR 登录等能力未接入

### 3.3 低优先级（辅助功能）

#### 3.3.1 代码结构优化
- ❌ 当前所有逻辑在单文件 `App.tsx`
- ❌ 未拆分为组件/feature 模块
- ❌ 类型定义分散

**建议拆分：**
```
src/
├── components/
│   ├── PrimaryNav.tsx
│   ├── ResourceSidebar.tsx
│   ├── ConversationCard.tsx
│   ├── Composer.tsx
│   └── ...
├── features/
│   ├── conversations/
│   ├── skills/
│   └── connections/
├── types/
│   └── index.ts
├── hooks/
│   └── useOpenClawSnapshot.ts
└── ...
```

#### 3.3.2 Gateway 连接管理
- ❌ WebSocket 连接状态未展示
- ❌ 断线重连未实现
- ❌ 认证管理未实现

#### 3.3.3 设置页
- ❌ 设置页未创建
- ❌ Gateway 地址配置未实现
- ❌ 主题/外观设置未实现

---

## 四、下一步工作建议

### 4.1 最紧急（让对话真正可用）

1. **接入 Gateway WebSocket**
   - 在 Tauri 端实现 WebSocket 连接
   - 或在前端直接连接 Gateway WS（需要处理认证）

2. **实现 `chat.send`**
   - 文本消息真实发送
   - 接收并展示响应流

3. **实现 `chat.history`**
   - 拉取当前会话历史记录
   - 替换当前本地 jsonl 预览

### 4.2 次紧急（完善核心流程）

4. **实现新建对话**
   - 左侧"新建对话"按钮真实功能
   - 创建后自动切换到新会话

5. **实现文件上传**
   - 选择文件
   - 上传并发送

### 4.3 后续优化

6. **代码拆分重构**
7. **Agent/Skill/Connection 管理功能**
8. **设置页**
9. **实时状态同步**

---

## 五、OpenClaw 对接参考

### 5.1 Gateway WebSocket

**连接地址：**
- 默认：`ws://127.0.0.1:18789`
- 认证：通过 `gateway.auth.token` 或 Tailscale Serve identity

**核心 RPC 方法：**

| 方法 | 用途 |
|------|------|
| `chat.history` | 拉取会话历史 |
| `chat.send` | 发送消息 |
| `chat.abort` | 停止当前运行 |
| `chat.inject` | 注入助手笔记（不触发运行） |
| `sessions.list` | 列出会话 |
| `sessions.create` | 创建新会话 |
| `sessions.patch` | 更新会话元数据 |
| `sessions.send` | 向会话发送消息 |

### 5.2 参考文档

- `/Users/zhangzy/Workspace/nodejs/clawdbot/docs/gateway/protocol.md`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/docs/web/control-ui.md`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/docs/web/webchat.md`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/docs/concepts/session-tool.md`

### 5.3 当前已确认的真实入口

| 功能 | 正确方式 |
|------|----------|
| 打开本地 OpenClaw | `openclaw dashboard --no-open` → 解析 Dashboard URL → 打开浏览器 |
| 读取配置 | `~/.openclaw/openclaw.json` |
| 读取会话元数据 | `~/.openclaw/agents/<agentId>/sessions/sessions.json` |
| 读取会话消息 | `~/.openclaw/agents/<agentId>/sessions/*.jsonl` |
| 读取 Skills | `~/Workspace/nodejs/clawdbot/skills` + `~/.agents/skills` |

---

## 六、给后续 AI / 开发者的提示

### 6.1 设计原则

1. **顺手 > 炫酷**
   - 不要改回 dashboard 风格
   - 不要加大标题、英文副标题、品牌展示块

2. **对话页是核心**
   - `agent + conversation` 的树形关系必须保留
   - 工作区只展示当前打开的对话
   - 左侧资源树保留全部对话

3. **隐藏 ≠ 删除**
   - 隐藏只影响工作区显示
   - 左侧仍然要能重新打开

4. **clawx 是工作台，不是独立聊天工具**
   - UI 围绕 OpenClaw 真实对象组织
   - 不要做成单纯的大模型聊天壳

### 6.2 当前已知问题

1. **单文件原型**
   - 所有逻辑在 `App.tsx`
   - 后续需要拆分

2. **mock 数据混合**
   - 部分数据来自真实 OpenClaw
   - 部分仍是 mock（如 conversations 的某些字段）
   - 需要逐步统一

3. **未接入真实发送**
   - 文本发送目前仅更新本地 UI
   - 未真正调用 OpenClaw

### 6.3 快速上手命令

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm tauri dev

# 仅构建前端
pnpm build

# 检查 Rust 端
cargo check --manifest-path src-tauri/Cargo.toml
```

### 6.4 关键文件

| 文件 | 用途 |
|------|------|
| `src/App.tsx` | 主界面逻辑 |
| `src/App.css` | 全局样式 |
| `src-tauri/src/lib.rs` | Tauri 命令桥接 |
| `src-tauri/tauri.conf.json` | Tauri 配置 |
| `package.json` | 前端依赖 |

---

## 七、版本历史

| 日期 | 版本 | 主要变更 |
|------|------|----------|
| 2026-04-17 | 原型 v1 | 初始骨架，mock 数据 |
| 2026-04-17 | 原型 v2 | 接入真实 OpenClaw 配置读取 |
| 2026-04-17 | 原型 v3 | 接入真实 session 元数据 |
| 2026-04-17 | 原型 v4 | 接入真实 session 消息预览 |
| 2026-04-17 | 原型 v5 | 对话页改造为聊天界面，发送区 + 历史消息 |
| 2026-04-17 | 原型 v6 | 简化界面，移除搜索/统计，聚焦聊天区 |

---

## 八、联系方式

- 项目位置：`/Users/zhangzy/Workspace/clawx`
- OpenClaw 文档：`/Users/zhangzy/Workspace/nodejs/clawdbot/docs`
- OpenClaw 配置：`~/.openclaw/openclaw.json`

---

*本文档会随项目进展持续更新。后续 AI 或开发者接手时，请优先阅读本文档 + README.md，然后查看 `src/App.tsx` 和 `src-tauri/src/lib.rs` 了解当前实现。*
