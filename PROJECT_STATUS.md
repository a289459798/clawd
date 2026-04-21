# clawx 项目状态文档

> 最后更新：2026-04-21 12:30 GMT+8
> 本文档只记录当前真实实现状态，方便后续继续开发。

---

## 〇、最近进展（2026-04-21）

### 2026-04-21 中午修复 — 消息 usage 显示与模型默认值

#### 消息 footer usage 修复
- **根因**：JSONL 中的 input 值是累积的（包含完整上下文），output 值是单次回复的
- 旧代码：直接取 JSONL 原始值，导致 input 显示异常大（如 `87.8K`），output 因非累积特性显示也不对
- 修复后：input 取相邻 assistant 消息的差值（delta），output 取原始值（已是单次回复）
- 同时新增 `cache_read_tokens` 和 `cache_write_tokens` 的 delta 计算

#### 模型默认值修复
- `resolveConversationDefaultModel` 的 useEffect 依赖项过多（`model`、`updatedAt`、`previewMessages`），导致不必要地频繁重置
- 修复后：仅依赖 `activeConversation?.id` 和 `resolveConversationDefaultModel`
- 优先级：1) 最后 assistant 消息的 model → 2) agent 配置 model → 3) 第一个选项

#### 类型补全
- `PreviewMessage` 新增 `cache_write_tokens` 字段
- `SessionMessage` Rust 结构同步新增 `cache_read_tokens` 和 `cache_write_tokens`
- `SnapshotSession.preview_messages` 前端类型同步更新

### 2026-04-21 下午完成的改动

#### 对话详情页 — 真实发送与流式更新
- 详情页已接入真实消息发送（`gateway_chat_send`）
- 发送后先插入本地占位消息，再用 `chat.delta` / `chat.final` 事件流式更新 assistant 回复
- final 事件完成后会主动重新拉取历史，补齐 usage 数据

#### 消息级模型展示与默认值
- assistant 消息已接入 `model / provider / api` 展示
- 模型默认值规则：有历史对话取上次 assistant 模型，新对话取 OpenClaw 默认模型
- 每次发送显式携带当前选中的模型

#### 消息 footer（类 webchat 用法展示）
- 仅在最后一条 assistant 消息底部显示
- 内容：`↑输出 ↓输入 R缓存 · 模型名 · 时间`
- token 使用紧凑格式（例如 `21.7K`）
- 进行中默认展开，完成后默认收起

#### 连续工具调用折叠
- 提升到消息流层做分组：连续纯工具消息合并为一个工具组
- 工具组展开后先列工具列表，再点单个工具看参数和结果
- 解决了之前“工具调用 1 项”刷屏的问题

#### Gateway 代理发送
- 通过 Tauri Rust 后端代理 Gateway `chat.history` / `chat.send`
- 不再依赖前端直连 Control UI websocket（规避 device identity / secure context 限制）
- 发送参数：`sessionKey / message / idempotencyKey / model / thinking / deliver=false / inputProvenance.kind=external_user`
- clawx 来源标识通过代理层请求头透传

---

## 一、项目定位

**clawx** 是一个基于 `Tauri + React + TypeScript` 的本地桌面端项目,目标是把 **OpenClaw 变成更顺手的桌面工作台**。

核心定位:

> **clawx = OpenClaw 的桌面工作台 / 管理壳,不是另一个聊天 UI。**

当前重点是:

- 用桌面工作流组织 OpenClaw 的 agent / session / skill / channel
- 提供更直观的对话列表与当前对话详情视图
- 优先打通真实本地数据读取,再逐步接入真实发送与实时同步

---

## 二、当前真实实现

### 2.1 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 19 |
| 语言 | TypeScript |
| 构建工具 | Vite 7 |
| 桌面端 | Tauri 2 |
| 后端桥接 | Rust / Tauri commands |

### 2.2 当前界面结构

#### 左侧一级导航
当前有 3 个模块:

- 对话
- 技能
- 连接

左下角有一个入口按钮,可直接打开本地 OpenClaw 网页。

#### 对话页
对话页由两部分组成:

1. **左侧资源区**
   - 展示 agent + 会话树
   - 每个会话显示标题、token、状态
   - 支持将隐藏会话重新加入主工作区

2. **主工作区**
   - 默认显示对话卡片列表
   - 点击卡片正文或右上角放大图标,进入当前对话详情页
   - 点击关闭图标,可将该对话从主工作区隐藏

#### 对话列表卡片当前展示内容

- 对话标题
- 所属 agent
- 模型名
- 累计 token 用量(例如 `19.4K`)
- 状态徽章
- 最后一条 assistant 回复摘要(优先)
- 最近活跃时间

当前列表规则:

- **不展示工作目录**
- 状态文案为:`进行中 / 已完成 / 空闲中`
- 排序顺序为:`进行中 → 已完成 → 空闲中`

当前状态判断规则:

- 最新消息是 `user`,且 30 分钟内有交互 → `进行中`
- 最新消息是 `assistant` / `toolResult`,且 30 分钟内有交互 → `已完成`
- 超过 30 分钟无交互 → `空闲中`

> 注意:这仍然是规则推断,不是 OpenClaw 明确返回的真实运行态字段。

#### 对话详情页当前展示内容

- 对话标题
- agent / model
- 工作目录
- 最近活跃时间
- token 统计拆分:
  - 总量
  - 输入
  - 输出
  - 缓存读取
  - 缓存写入
- 最近上下文预览
- 可直接发送消息的输入区

当前详情页是**主界面内详情页**,不是独立子窗口。

#### 技能页
当前展示:

- skill 名称
- 简短说明
- 文件路径
- 启用状态

#### 连接页
当前展示:

- channel / connection 名称
- 连接状态
- 配置项位置
- 最近活动信息

---

## 三、真实数据接入情况

### 3.1 已接入的数据源

| 数据源 | 路径 | 状态 |
|--------|------|------|
| OpenClaw 主配置 | `~/.openclaw/openclaw.json` | ✅ 已接入 |
| Agent 列表 | 从主配置解析 | ✅ 已接入 |
| Session 元数据 | `~/.openclaw/agents/<agentId>/sessions/sessions.json` | ✅ 已接入 |
| Session 消息预览 | `~/.openclaw/agents/<agentId>/sessions/*.jsonl` | ✅ 已接入 |
| Session token 用量 | `*.jsonl` 中的 `usage.*` | ✅ 已接入 |
| Skills 列表 | `~/Workspace/nodejs/clawdbot/skills` + `~/.agents/skills` | ✅ 已接入 |
| Channels 列表 | 从主配置解析 | ✅ 已接入 |
| Dashboard URL | `openclaw dashboard --no-open` | ✅ 已接入 |

### 3.2 当前 Tauri 命令

| 命令 | 功能 | 状态 |
|------|------|------|
| `resolve_dashboard_url` | 获取本地 OpenClaw dashboard URL | ✅ |
| `load_openclaw_snapshot` | 读取本地 OpenClaw 配置和会话快照 | ✅ |
| `resolve_gateway_auth` | 读取本地 Gateway websocket 地址和 token | ✅ |
| `gateway_status` | 获取 Tauri Gateway 代理连接状态 | ✅ |
| `gateway_chat_history` | 通过 Tauri Gateway 代理拉取会话历史 | ✅ |
| `gateway_chat_send` | 通过 Tauri Gateway 代理发送消息 | ✅ |

### 3.3 当前快照结构

```ts
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
    latest_event_role?: string;
    latest_event_type?: string;
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
    total_tokens?: number;
    total_tokens_fresh?: boolean;
    estimated_cost_usd?: number;
    preview_messages: Array<{
      role?: string;
      text: string;
      parts?: MessagePart[];
      model?: string;
      provider?: string;
      api?: string;
      timestamp?: number;
      input_tokens?: number;
      output_tokens?: number;
      cache_read_tokens?: number;
    }>;
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

---

## 四、已完成的关键改动

- ✅ 明确产品定位为 OpenClaw 桌面工作台
- ✅ 修正对话列表"缩小/返回列表"逻辑
- ✅ 对话列表摘要改为优先显示最后一条 assistant 回复
- ✅ 去掉顶部对话工具栏中的搜索、新建对话、刷新历史入口
- ✅ 调整列表响应式布局,避免小窗口重叠
- ✅ 卡片标题与按钮布局收紧
- ✅ 放弃不稳定的子窗口方案,改为主界面内详情页
- ✅ 对话详情页骨架完成
- ✅ 从真实 session jsonl 中解析最后回复摘要
- ✅ 从真实 session jsonl 中累计 token 统计
- ✅ 详情页展示 token 拆分统计
- ✅ 列表页样式收敛,弱化摘要和时间视觉权重
- ✅ README 与本状态文档已同步到当前实现
- ✅ 列表页已接入基于本地 OpenClaw session transcript 的准实时增量刷新(状态、摘要、usage)
- ✅ 对话详情页已接入真实发送能力,底层改为 Tauri Rust 后端代理 Gateway `chat.history` + `chat.send`
- ✅ 发送参数已接入 `sessionKey / message / idempotencyKey / model / thinking / deliver=false / inputProvenance.kind=external_user`
- ✅ clawx 来源标识已通过代理层请求头透传
- ✅ assistant 消息级已接入 `model / provider / api` 展示
- ✅ 模型默认值逻辑已接入,优先使用会话上次回复模型,否则回退到 OpenClaw 默认模型
- ✅ 每次发送都会显式携带当前选中的模型
- ✅ 发送后先插入本地占位消息，再用 chat delta/final 事件刷新 assistant 回复
- ✅ final 完成后主动刷新历史，补齐 usage 数据到 footer
- ✅ assistant 消息 footer 仅挂在最后一条回复底部，显示 `↑输出 ↓输入 R缓存 · 模型 · 时间`
- ✅ token 数字使用紧凑格式（例如 `21.7K`）
- ✅ 连续纯工具消息（多条连续消息）折叠为一个工具组，解决工具刷屏
- ✅ 工具组内支持二级展开：先看工具列表，再点看单个工具的参数和结果
- ✅ streaming 中默认展开工具组，完成后默认收起
- ✅ 消息渲染保持原 transcript 顺序，不再重排

---

## 五、当前未完成项

### 5.1 高优先级

#### 真实发送能力
- ✅ 详情页已接入真实消息发送
- ✅ 模型 / 思考模式已真正下发到 Gateway 发送参数
- ✅ 流式更新（delta/final）已接入
- ❌ 未接入文件上传
- ❌ 未接入音频发送

#### 真实历史拉取
- ✅ 当前详情页已接入 `chat.history`
- ✅ final 后自动刷新补齐 usage
- ❌ 未实现分页或增量加载
- ⚠️ 部分消息的 usage 数据在某些场景下仍未正确显示（待对齐 webchat 用法计算逻辑）

#### 新建对话
- ❌ 左侧"新建对话"按钮还未接真实创建流程
- ❌ 新建对话的默认模型取 OpenClaw 配置还没接

### 5.2 中优先级

#### 真实运行状态
- ⚠️ 当前列表状态已支持准实时刷新，但仍基于 transcript 增量事件 + 本地规则推断
- ❌ 还未接入 Gateway RPC 明确提供的标准运行态字段

#### footer 对齐 webchat 用法条
- ⚠️ 当前 footer 已接入 `↑输出 ↓输入 R缓存 · 模型 · 时间`
- ❌ 尚未对齐 webchat 的 `0%`（缓存命中率）和 `ctx`（上下文占比）
- ❌ 需要确认 webchat 的 ↑/↓ 究竟对应 usage 里哪个字段

#### 管理能力
- ❌ 新建 Agent 未实现
- ❌ Agent 配置编辑未实现
- ❌ Skill 启停与安装未实现
- ❌ Connection 配置编辑与刷新未实现

### 5.3 低优先级

#### 代码结构整理
- ❌ 当前主要逻辑仍集中在 `src/App.tsx`
- ❌ 尚未拆分为组件 / feature 模块

建议未来拆分:

```txt
src/
├── components/
├── features/
├── hooks/
├── types/
└── ...
```

---

## 六、下一步建议

### 第一优先级
1. **footer 对齐 webchat** — 确认 ↑/↓/R/0%/ctx 与 usage 字段的对应关系
2. **新建对话** — 打通真实创建流程，默认模型取自 OpenClaw 配置
3. **接入文件上传** — 支持图片/文件发送到 Gateway

### 第二优先级
4. 接入音频发送
5. 在 OpenClaw CLI 配置恢复后，进一步直接消费更完整的 Gateway RPC / 标准事件流，减少 transcript watcher 依赖
6. 做详情页和列表页的进一步视觉收敛
7. 拆分 `App.tsx` — 拆为组件 / feature 模块

### 第三优先级
8. 新建 Agent / Agent 配置编辑
9. Skill 启停与安装
10. Connection 配置编辑与刷新
11. 历史消息分页 / 增量加载

---

## 七、关键文件

- `/Users/zhangzy/Workspace/clawx/src/App.tsx`
- `/Users/zhangzy/Workspace/clawx/src/App.css`
- `/Users/zhangzy/Workspace/clawx/src/main.tsx`
- `/Users/zhangzy/Workspace/clawx/src-tauri/src/lib.rs`
- `/Users/zhangzy/Workspace/clawx/src-tauri/src/main.rs`
- `/Users/zhangzy/Workspace/clawx/src-tauri/Cargo.toml`
- `/Users/zhangzy/Workspace/clawx/src-tauri/tauri.conf.json`
- `/Users/zhangzy/Workspace/clawx/README.md`

---

## 八、当前验证命令

```bash
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

当前这两条验证命令可通过。
