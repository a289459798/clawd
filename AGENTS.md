# clawx 开发规范

本文档是后续 AI / 开发者接手本仓库时必须优先遵守的工程约束。改动代码前先读本文件，再按需阅读 `README.md`、`PROJECT_STATUS.md` 和 `docs/plans/`。

## 项目定位

clawx 是 OpenClaw 的本地桌面工作台，不是新的聊天机器人 UI，也不是 OpenClaw 的平行实现。

开发时保持这个方向：

- 以桌面软件的工作流组织 agent / session / skill / channel。
- 对话页是核心页面，左侧资源树和主工作区关系不能随意打散。
- 隐藏对话只是从主工作区隐藏，不是删除，也不能让会话从可检索数据源消失。
- 设计应克制、耐用、适合长期工作，不要改回营销页、大 dashboard、超大标题或装饰性展示页。

## 平台兼容

clawx 是桌面应用，核心交付平台必须同时兼容：

- macOS
- Windows

Linux 可以保留基础兜底能力，但不能作为替代 macOS / Windows 兼容性的理由。

涉及以下能力时，必须同时考虑 macOS 和 Windows：

- OpenClaw 安装与检测
- 外部终端、shell、PowerShell 调用
- 文件路径、用户目录、配置文件路径
- Tauri command 后端桥接
- 打开外部 URL、文件选择器、目录选择器
- Gateway 启动、连接、状态检测
- 文档中的运行命令和排障步骤

不要把 macOS 专有命令写成唯一实现，例如：

- `osascript`
- `open`
- `/Users/...`
- `~/.zshrc`
- `bash` / `sh` only

如果必须使用平台专有能力，应在 Rust/Tauri 后端按平台分流，并给 Windows 提供等价实现。

## OpenClaw 集成原则

OpenClaw Gateway RPC/events 是运行态和规范数据的第一来源。

数据来源优先级：

1. Gateway RPC/events：实时且规范的数据。
2. 本地 snapshot 读取：冷启动或 Gateway 不可用时的 fallback。
3. 直接写 OpenClaw 配置/会话文件：只允许用于明确的 bootstrap 场景，且没有 Gateway 方法可用时才考虑。

开发守则：

- 优先使用 `agents.list`、`sessions.list`、`sessions.preview`、`chat.history`、`skills.status`、`channels.status` 等 Gateway 方法。
- 不要复制 OpenClaw 的 session key 规范化、session store 解析、transcript 路径发现逻辑；这些应由 Gateway 负责。
- 不要依赖固定配置路径作为唯一来源。OpenClaw 支持 `OPENCLAW_CONFIG_PATH`、`OPENCLAW_STATE_DIR` 和 session store override。
- 不要在 `chat.send` payload 里新增 OpenClaw schema 不接受的字段。模型变更应先通过 `sessions.patch` 保存到 session，再发送消息。
- Gateway 事件不是完整历史回放；UI 遇到断线、切换会话、final/error/abort 后，应通过 `chat.history` 或对应列表 RPC 做 reconciliation。
- 本地 optimistic UI 状态要和 Gateway canonical rows 分开，刷新时不能擦掉正在发送或流式生成中的本地消息。

## OpenClaw 安装引导

未检测到 OpenClaw 时，应用应提供：

- “立即安装”：打开系统终端并执行官方安装脚本。
- “我已安装，重新检测”：重新检测本机环境。

安装脚本应来自 OpenClaw 官方文档：

- macOS / Linux: `curl -fsSL https://openclaw.ai/install.sh | bash`
- macOS / Linux fallback: `curl -fsSL https://openclaw.ai/install-cli.sh | bash`
- Windows: `iwr -useb https://openclaw.ai/install.ps1 | iex`

安装过程不应静默隐藏。应让用户看到终端输出、onboarding 提示和错误信息。安装完成后由用户回到 clawx 点击重新检测。

macOS 上常见失败场景是 npm 全局目录指向 root-owned `/usr/local`，导致 `npm install -g openclaw@latest` 失败。安装逻辑必须为这种情况保留 local-prefix fallback，不要只依赖全局 npm 安装。

local-prefix 安装后，OpenClaw CLI 通常位于 `~/.openclaw/bin/openclaw`。运行时检测和所有后端命令执行必须识别这个路径，不能只依赖 `command -v openclaw`。

## Gateway 设备身份

clawx 作为 Gateway 客户端连接时必须携带 device identity。OpenClaw 要求：

- `device.id` 必须等于 Ed25519 raw public key 的 SHA-256 hex 指纹。
- `device.publicKey` 是 Ed25519 raw public key 的 base64url-no-padding 表示。
- `device.signature` 必须按 OpenClaw v3 connect payload 规则签名。

不要生成随机 `deviceId`。如果旧版本已保存随机 `deviceId`，应在读取 identity 时自动迁移为 public key 指纹，否则 Gateway 会返回 `device identity mismatch` / `device-id-mismatch`。

## OpenClaw 文档与源码

需要确认 OpenClaw 行为时，优先顺序：

1. 本项目文档：`README.md`、`PROJECT_STATUS.md`、`docs/plans/`。
2. OpenClaw 官方文档或本机 OpenClaw 源码仓库的 `docs/`。
3. OpenClaw 源码中的 Gateway schema、server methods、session store 实现。

如果本机存在相邻 OpenClaw 源码仓库，优先参考它的当前实现，但不要把本机绝对路径写入 runtime 代码或文档示例。文档示例应使用相对路径、环境变量或通用路径。

## UI 与交互规范

- 首屏应是可用的工作台，不做 landing page。
- 对话、技能、连接、用量等页面应保持工具型桌面软件气质，避免装饰性卡片堆叠。
- 资源侧栏应保留 agent + session 的结构。
- 对话详情要支持低摩擦发送、停止生成、附件、模型/思考参数、流式状态和历史 reconciliation。
- 长会话不要一次渲染巨大历史；优先做分段加载，再考虑虚拟列表依赖。
- destructive actions 必须确认，例如 reset、delete、清空、覆盖配置。
- 错误信息要能帮助用户下一步行动，尤其是 Gateway 未连接、OpenClaw 未安装、权限/终端打开失败。

## 代码组织

- React 组件放在 `src/components/`。
- 共享业务类型放在 `src/types/`。
- 纯函数、转换器、选择器放在 `src/lib/`，并优先补测试。
- 业务 hooks 放在 `src/hooks/`。
- Tauri command 和本机能力桥接放在 `src-tauri/src/`。
- Gateway WebSocket 代理优先集中在 `src-tauri/src/gateway_proxy.rs`。

保持变更小而聚焦。不要在功能改动里夹带无关重构、格式化或样式大清洗。

## 跨平台实现细节

Rust/Tauri 后端涉及系统能力时应使用平台分支，例如：

- macOS 使用 Terminal / AppleScript 时，Windows 必须有 PowerShell 或等价实现。
- Windows 路径处理不能假设 `/`、`~`、`HOME`、可执行文件无扩展名。
- 用户目录优先通过系统 API 或环境变量解析，不要写死 `/Users/<name>`。
- 外部命令失败时返回可读错误，前端应展示并允许重试。

前端不要直接假设平台；平台差异应尽量收敛到 Tauri command。

## 验证要求

涉及前端或 Tauri 后端改动时，至少运行：

```bash
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

涉及纯函数、适配器、消息合并、选择器时，补充或运行相关测试：

```bash
pnpm test
```

涉及 Gateway 数据或聊天链路时，手动回归至少覆盖：

- Gateway 运行时加载 session list。
- Gateway 不可用时 fallback/bootstrap 状态可读。
- 新建 session。
- 发送文本消息。
- 发送图片或图文混合消息。
- 停止生成。
- 切换模型后发送。
- 隐藏并恢复对话。

涉及平台分支时，代码结构必须能清楚看出 macOS 和 Windows 的路径都被覆盖；如果无法在当前机器实测另一个平台，应在最终说明里明确未实测的平台和残余风险。

## 禁止事项

- 不要把 clawx 做成 OpenClaw 的平行 session/agent/skill/channel 实现。
- 不要移除本地 snapshot fallback，除非 Gateway RPC parity 已经验证并有明确迁移计划。
- 不要把开发者机器路径写入 runtime 代码。
- 不要直接扫描 OpenClaw 源码目录作为产品数据来源。
- 不要绕过 Gateway 写 agent/session/skill/channel 配置，除非明确属于 bootstrap 且没有 Gateway 方法。
- 不要让安装流程静默运行在后台而没有用户可见输出。
