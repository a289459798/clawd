# clawx 项目状态文档

> 最后更新：2026-05-02 GMT+8
> 本文档只记录当前真实实现状态，方便后续继续开发。

---

## 〇、最近进展（2026-05-02）

### 模型管理页

- 新增“模型”一级导航，采用左右结构：左侧 provider，右侧展示选中 provider 的模型。
- Provider 配置和添加模型已区分：
  - Provider 配置包含 API Key、Base URL、OAuth 等连接信息。
  - 添加/修改模型只包含模型名称、别名、是否默认等使用信息。
- 未配置 provider 时，模型列表显示禁用状态并提示“请先配置 Provider”。
- 已配置 provider 的模型支持“修改”和“设为默认”。
- 左侧支持添加自定义 provider；已配置 provider 旁支持增加 model。
- 支持 OAuth 的 provider 提供授权入口，授权逻辑走 OpenClaw CLI 可见流程。
- 默认模型写入 OpenClaw 配置，当前通过 `config.get` + `baseHash` + `config.patch` 更新 `agents.defaults.model.primary` 和 allowlist。

### 页面性能与异步加载

- 模型、技能、连接、用量页面已改为先打开页面 shell，再异步加载数据。
- 慢 Gateway RPC 已在 Tauri 后端改为 async command + `tauri::async_runtime::spawn_blocking`，避免页面切换时出现系统等待光标。
- 已优化模型页设为默认、保存 provider、保存 model 等操作：按钮级 loading + 乐观更新 + 后台刷新。
- 已知慢 RPC：`models.list` 全量 catalog、`models.authStatus`、`skills.status`、`channels.status`、`sessions.usage`、`config.patch`。后续新增页面或按钮时应默认按异步交互处理。

### OpenClaw 安装、更新与连接

- OpenClaw CLI 检测已兼容 local-prefix 安装路径，尤其是 `~/.openclaw/bin/openclaw`。
- OpenClaw 左下角图标支持“有更新”角标；更新弹层展示当前版本和最新版本。
- 更新按钮使用 `openclaw update`，不是重新跑安装脚本。
- Gateway device identity 已按 OpenClaw 要求使用 Ed25519 public key SHA-256 指纹，并兼容旧随机 device id 的迁移。

### Channel 与 WeChat

- 连接页展示所有 channel，但不再展示 `channels.xxx` 这类内部配置字段。
- 每个 channel 检测/安装/启用过程有局部 loading。
- WeChat channel 已按 `@tencent-weixin/openclaw-weixin` 接入安装、启用、版本检查、更新和登录入口。
- 安装后会尝试启用插件并刷新状态，避免用户看到“已安装但未启用/未同步”的假状态。

### 对话链路

- 发送错误如果 `gateway_chat_send` 返回字符串，会在对话详情底部展示错误，并结束 loading。
- 发送成功期望返回 `{ runId, status: "started" }`。
- 对话模式和专注模式的发送/接收逻辑已重新梳理，避免 Sender metadata 展示、用户消息重复、AI 回复重复拼接。
- 工具调用在对话模式中按消息样式展示。
- 模型和 token 用量改为跟随每条 assistant 消息展示，不固定在页面底部。
- Composer `thinklevel` 默认值为 `off`。

### 验证

- `pnpm build` ✅
- `cargo check --manifest-path src-tauri/Cargo.toml` ✅

### 后续建议

- 给模型 provider/model 配置补测试，尤其是 `config.patch` payload 和默认模型选择。
- 继续接入 SecretRef / schema-driven config，避免 API Key 明文回显。
- 给慢 RPC 增加前端超时与重试提示。
- 对 Windows 终端授权、OpenClaw 更新和 OAuth 流程做实机回归。

---

## 〇、最近进展（2026-04-28）

### 2026-04-28 下午 — `App.tsx` 拆分收尾与构建修复

#### 前端结构拆分
- `App.tsx` 已从 1234 行降到约 761 行。
- 已接入并实际使用拆分后的 hooks：
  - `src/hooks/useGatewayChat.ts`：负责订阅和处理 `clawx://gateway-chat` 事件，包括 tool stream、delta、final、error 状态。
  - `src/hooks/useMessageSender.ts`：负责发送消息、草稿会话转真实 session、乐观插入 user 消息、错误时恢复 composer、排队消息重试。
  - `src/hooks/useModels.ts`：负责加载 Gateway 模型列表。
- 继续保留 `App.tsx` 作为页面状态编排层，具体事件处理和发送链路下沉到 hooks。

#### 构建问题修复
- 修复拆分过程中产生的错误 import / unused import。
- 修复 `mergeStreamingParts` 引用位置，统一从 `gatewayMessages` 读取。
- 修复 `useGatewayRealtime` 的 `onAgentsChange` updater 类型不匹配。
- 移除 `ResourceSidebar` 未使用的 `statusLabel` prop。

#### 验证
- `pnpm build` ✅
- 当前构建输出正常，Vite production build 通过。

#### 后续建议
- 继续把 bootstrap / realtime session patch / open conversation detail 逻辑拆成独立 hooks。
- 给 `useGatewayChat` 和 `useMessageSender` 增加更小粒度的纯函数测试，降低流式消息合并逻辑回归风险。
- 在提交前做一次 UI 手动回归：新建对话、发送文本、发送图片、停止生成、工具调用折叠、隐藏/恢复对话。

## 〇、最近进展（2026-04-22）

### 2026-04-22 上午 — 新建对话、停止生成、图片发送与结构拆分

#### Gateway 能力补齐
- Rust 代理新增 `gateway_chat_abort`
- Rust 代理新增 `gateway_sessions_create`
- `gateway_chat_send` 新增 `attachments` 支持，目前已接入图片 base64 发送

#### 对话能力补齐
- 发送中状态下，发送按钮可切换为“停止”，并调用 `chat.abort`
- composer 已支持图片选择、附件 chip 展示、删除附件、纯图片发送与图文混发
- 左侧 agent 区的“＋”已接入真实 `sessions.create`，支持直接新建对话
- 新建对话默认模型逻辑已优化为：优先 agent 默认模型，再回退全局默认模型

#### 前端结构整理
- 抽出 `buildAgentsFromSnapshot(...)` 与 `resolveAgentDefaultModel(...)`
- 新增独立组件：
  - `src/components/ConversationComposer.tsx`
  - `src/components/ConversationDetail.tsx`
  - `src/components/ConversationCard.tsx`
  - `src/components/ConversationList.tsx`
- 抽出共享类型：`src/types/conversation.ts`
- 抽出详情页消息状态推导：`src/lib/conversationDetailState.ts`

#### 验证
- `cargo check --manifest-path src-tauri/Cargo.toml` ✅
- `pnpm build` ✅

## 〇、最近进展（2026-04-21）

### 2026-04-21 下午 — Gateway WebSocket 接入与真实消息发送

#### Gateway WebSocket 代理
- **根因**：旧代码使用 HTTP POST 到 `/gateway/rpc`，但该端点返回 404。Gateway 的 RPC 方法走 WebSocket 协议
- 新实现：通过 `tungstenite` crate 建立 WebSocket 连接
- 握手流程：连接 → 接收 `connect.challenge` → 发送 `auth` → 接收 `connect.auth_ok`
- 事件监听：后台线程持续读取 WS 消息，分发 `clawx://gateway-chat`、`clawx://sessions-changed` 事件
- RPC 请求：通过 WebSocket 发送 JSON-RPC 帧，同步等待响应
- 连接管理：`gateway_connect` 命令初始化连接，`send_rpc` 复用连接
- ping/pong：自动响应 Gateway 的 ping 消息
- 断线处理：WS 断开时更新连接状态，唤醒所有等待中的 RPC

#### 依赖变更
- 新增：`tungstenite = "0.26"`（带 `rustls-tls-native-roots` 功能）
- 移除：`reqwest` 的 blocking 客户端（但仍保留用于其他场景）

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
当前有 5 个模块:

- 对话
- 模型
- 技能
- 连接
- 用量

左下角有一个入口按钮,可直接打开本地 OpenClaw 网页；检测到 OpenClaw CLI 新版本时会显示“有更新”角标。

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

#### 模型页
当前展示:

- Provider 列表
- Provider 是否已配置
- OAuth 授权状态
- Provider 下模型列表
- 添加/修改模型
- 设置默认模型

Provider 配置与 Model 配置分开处理。未配置 provider 的模型列表不可用，并提示“请先配置 Provider”。

#### 连接页
当前展示:

- channel / connection 名称
- 连接状态
- 最近活动信息
- 安装、启用、登录、更新等 channel 相关动作

#### 用量页
当前展示:

- 输入/输出/cache/cost 汇总
- 按 agent、model、recent session 的使用情况拆分

---

## 三、真实数据接入情况

### 3.1 已接入的数据源

| 数据源 | 入口 | 状态 |
|--------|------|------|
| Agent 列表 | Gateway `agents.list`，snapshot fallback | ✅ 已接入 |
| Session 元数据 | Gateway `sessions.list` / `sessions.preview`，snapshot fallback | ✅ 已接入 |
| Session 消息历史 | Gateway `chat.history`，本地 transcript fallback | ✅ 已接入 |
| Session token 用量 | Gateway / transcript `usage.*` | ✅ 已接入 |
| Models 列表 | Gateway `models.list` | ✅ 已接入 |
| Models OAuth 状态 | Gateway `models.authStatus` | ✅ 已接入 |
| OpenClaw 配置读写 | Gateway `config.get` + `config.patch` | ✅ 已接入 |
| Skills 列表 | Gateway `skills.status` | ✅ 已接入 |
| Channels 列表 | Gateway `channels.status` | ✅ 已接入 |
| Usage 汇总 | Gateway `sessions.usage` | ✅ 已接入 |
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
| `gateway_chat_abort` | 通过 Tauri Gateway 代理停止生成 | ✅ |
| `gateway_sessions_create` | 通过 Tauri Gateway 代理新建对话 | ✅ |
| `gateway_models_list` | 读取模型 provider/model 列表 | ✅ |
| `gateway_models_auth_status` | 读取模型 OAuth 授权状态 | ✅ |
| `gateway_config_get` | 读取 OpenClaw 配置 | ✅ |
| `gateway_config_patch` | 写入 OpenClaw 配置 patch | ✅ |
| `gateway_skills_status` | 读取 skills 状态 | ✅ |
| `gateway_channels_status` | 读取 channels 状态 | ✅ |
| `gateway_sessions_usage` | 读取 usage 汇总 | ✅ |

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
- ✅ 首次启动已增加 OpenClaw 环境检查与绑定确认流程，未安装 / 未绑定时不进入主界面
- ✅ 用户同意后可自动写入 `~/.openclaw/openclaw.json` 的 `gateway.controlUi.allowedOrigins`
- ✅ 已移除界面里的演示 mock 数据，列表/技能/连接页改为仅展示真实本地数据或空状态
- ✅ 列表页已接入基于本地 OpenClaw session transcript 的准实时增量刷新(状态、摘要、usage)
- ✅ 对话详情页已接入真实发送能力,底层改为 Tauri Rust 后端代理 Gateway `chat.history` + `chat.send`
- ✅ 发送参数已接入 `sessionKey / message / idempotencyKey / model / thinking / deliver=false / inputProvenance.kind=external_user`
- ✅ clawx 来源标识已通过代理层请求头透传
- ✅ assistant 消息级已接入 `model / provider / api` 展示
- ✅ 模型默认值逻辑已接入,优先使用会话上次回复模型,否则回退到 OpenClaw 默认模型
- ✅ 每次发送都会显式携带当前选中的模型
- ✅ 发送后先插入本地占位消息，再用 chat delta/final 事件刷新 assistant 回复
- ✅ delta 阶段已改为持续拼接流式文本，并兼容结构化工具 / 图片片段
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
- ✅ 已接入图片上传发送（base64 attachments）
- ✅ 已接入停止生成
- ❌ 未接入通用文件上传
- ❌ 未接入音频发送

#### 真实历史拉取
- ✅ 当前详情页已接入 `chat.history`
- ✅ final 后自动刷新补齐 usage
- ❌ 未实现分页或增量加载
- ⚠️ 部分消息的 usage 数据在某些场景下仍未正确显示（待对齐 webchat 用法计算逻辑）

#### 新建对话
- ✅ 左侧“新建对话”按钮已接真实创建流程
- ✅ 新建对话默认模型已接为：agent 默认模型优先，其次全局默认模型

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
- ⚠️ `src/App.tsx` 仍是主编排层，但已明显瘦身
- ✅ 已拆出 composer / detail / list / card 组件
- ✅ 已抽出共享类型与详情页消息状态推导

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

- `src/App.tsx`：主界面状态编排层。
- `src/App.css`：当前全局样式与页面布局。
- `src/components/ConversationDetail.tsx`：对话详情、消息流、工具调用与消息 footer。
- `src/components/ConversationComposer.tsx`：发送区、附件、思考等级、停止生成。
- `src/components/ModelsPage.tsx`：模型 provider / model 管理页。
- `src/components/InfoPages.tsx`：技能、连接、用量等信息页。
- `src/hooks/useGatewayChat.ts`：Gateway chat event 处理。
- `src/hooks/useMessageSender.ts`：发送消息、草稿会话转真实 session、错误恢复。
- `src/hooks/useModels.ts`：模型列表加载。
- `src-tauri/src/lib.rs`：Tauri command 注册与本机能力桥接。
- `src-tauri/src/gateway_proxy.rs`：Gateway WebSocket 代理、RPC、事件转发与慢 RPC async command。
- `src-tauri/Cargo.toml`：Rust 依赖。
- `README.md`、`AGENTS.md`、`docs/plans/`：后续 AI / 开发者接手前应先读。

---

## 八、当前验证命令

```bash
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

当前这两条验证命令可通过。
