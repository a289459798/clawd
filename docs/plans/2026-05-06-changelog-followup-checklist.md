# Changelog Follow-Up Checklist

> Last updated: 2026-05-06 — statuses synced with clawkit implementation (batch + 「重复操作反馈」).

This checklist is based on OpenClaw changelog items after 2026.4.24 from:

- `/Users/zhangzy/Workspace/nodejs/clawdbot/CHANGELOG.md`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/apps/ios/CHANGELOG.md`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/extensions/matrix/CHANGELOG.md`

Scope: only track items that make sense for clawkit as a local desktop workbench. Channel-runtime internals, plugin SDK internals, iOS-only build hygiene, and provider-specific backend fixes stay out unless they change clawkit user-facing behavior.

## Already Landed In This Pass

- [x] Parse OpenClaw inbound media markers such as `[media attached: /path/file.xlsx (mime)]` into file attachment parts.
- [x] Render file attachments as clickable attachment cards in chat history and the focused user-message summary.
- [x] Allow opening OpenClaw media files through Tauri opener with scoped `$HOME/.openclaw/media/**` permission.
- [x] Send non-image attachments through the Gateway attachment payload instead of treating every file as an image.
- [x] Display selected agent runtime on sessions and support runtime filtering in clawkit session list.
- [x] Map Gateway session runtime states (`running`, `done`, `failed`, `timeout`, `killed`) to distinct clawkit UI statuses.
- [x] Persist model and thinking changes through `sessions.patch` before `chat.send`.
- [x] Stop passing schema-extra thinking fields through `chat.send`.
- [x] Reconcile Gateway ack `runId` back into local conversation runtime so stop/realtime matching stays aligned.

## P0: Chat And Session UX

- [x] Collapse consecutive duplicate text-only messages into one bubble with a count.
  Source: `Control UI/chat: collapse consecutive duplicate text messages`.
  Notes: implement in normalized message rendering, not in stored history.

- [x] Hide heartbeat/no-op events from all visible transcript modes.
  Source: `Control UI/chat: suppress HEARTBEAT_OK acknowledgement history, streams, deltas, and final events`.
  Notes: current internal-message filter handles some cases; audit streaming deltas/finals and snapshot previews.

- [x] Add filtered-empty vs genuinely-empty states for session list search/runtime filters.
  Source: `Control UI: distinguishing filtered-empty session lists from genuinely empty session stores`.
  Notes: current empty state says there are no visible conversations even when filters may be hiding rows.

- [x] Add visual feedback for repeated actions.
  Source: `Control UI: announce session switches, flash active session selector, show inline Save/Apply/Update progress`.
  Notes: useful for session switch, title save, model/thinking patch, hide/restore.

- [x] Keep the composer/control row responsive at narrow widths.
  Source: `Control UI/chat: keep chat controls/composer responsive across phone/tablet/desktop widths`.
  Notes: desktop app still needs narrow-window behavior on macOS/Windows.

- [x] Hide or compact the chat controls row while scrolling down long transcripts.
  Source: `Control UI/chat: hide that row while scrolling down the transcript`.
  Notes: only if it improves clawkit's desktop workbench feel; keep composer discoverable.

## P0: Gateway Reconciliation And Robustness

- [x] Treat canonical session aliases and emitted session keys as the same active run.
  Source: `Control UI/chat: keep live replies visible when a raw session alias such as main sends the chat turn but Gateway emits events under the canonical session key`.
  Notes: add alias mapping around `activeConversationId`, realtime events, and optimistic rows.

- [x] Handle queued same-session follow-up turns without false `ReplyRunAlreadyActiveError` UI states.
  Source: `Gateway/chat: clear the active reply-run guard before draining queued same-session follow-up turns`.
  Notes: clawkit already queues while active; verify Gateway ack/final ordering and auto-send next queued item.

- [x] Refresh exact active session rows instead of hydrating stale large stores.
  Source: `TUI/sessions: bound the session picker to recent rows and use exact lookup-style refreshes for the active session`.
  Notes: `sessions-changed` with an active reply-run calls `sessions.list` and `mergeGatewaySessionRowsIntoAgents` (metadata merge + transcript truth); new remote keys still trigger full snapshot. Removed “local id missing from list → full reload” to avoid false positives when the list is capped.

- [x] Show session cleanup/orphan state if Gateway exposes it.
  Source: `CLI/sessions: prune old unreferenced transcript, compaction checkpoint, and trajectory artifacts`.
  Notes: surface Gateway `sessions.preview` status `missing`/`error` and session-row compaction checkpoint fields in conversation detail; no local transcript scanning. Gateway `sessions.cleanup` remains CLI-side (no dry-run in RPC schema).

## P1: Models And Auth

- [x] Add model auth profile visibility.
  Source: `Models/auth: add openclaw models auth list [--provider <id>] [--json]`.
  Notes: list Gateway `models.authStatus` profiles (`profileId` / type / health / expiry) under each Provider detail; empty-profile explainer for env/API-key-only setups.

- [x] Show session-scoped wording around model changes.
  Source: Telegram/Mattermost model picker wording: model picker changes session model, runtime switch is separate.
  Notes: composer model selector should make clear it changes the current session, not agent defaults.

- [x] Add blocked-model repair guidance when a model is not in the allowlist.
  Source: `Model switching: include the exact additive allowlist repair command`.
  Notes: surface actionable command or config path when `sessions.patch` model fails.

- [x] Ensure thinking picker comes from provider policy even when plugin registry is not active.
  Source: `Thinking/providers` and `Providers/DeepSeek` lightweight policy entries.
  Notes: when session rows omit thinkingLevels, Composer uses Gateway `sessions.list` defaults.thinkingLevels (same source as OpenClaw policy); snapshot + light-merge refresh that payload.

- [x] Add Codex audio transcription capability display.
  Source: `OpenAI/Codex media: advertise Codex audio transcription`.
  Notes: ModelsPage capability chips honor Gateway catalog `input` (audio) and transcription-related `tags`; tooltip clarifies Codex-style audio transcription when marked as audio input.

## P1: Channels, Plugins, And Diagnostics

- [x] Improve channel status degradation display.
  Source: `Discord/status: degraded transport and event-loop starvation signals in channels status/status --deep`.
  Notes: map channel health states into connection cards with clear "running but degraded" language.

- [x] Surface plugin packaging diagnostics with repair actions.
  Source: source-only TypeScript package warnings and official-plugin install hints.
  Notes: skills/connections pages should show update/reinstall/disable suggestions, not raw plugin load text.

- [x] Surface SecretRef/config contract readiness for externalized plugins.
  Source: external channel contracts under `dist/` and SecretRef preservation.
  Notes: connection setup should distinguish "configured secret missing" from "plugin contract missing".

## P1: Cron And Automation

- [x] Add cron list page or panel filtered by agent.
  Source: `openclaw cron list --agent <id>`.
  Notes: 新导航「定时」页调用 Gateway `cron.list`（`agentId` 筛选）；列表只读，符合工作台不做平行 automation 实现的原则。

- [x] Make the new cron job form collapsible beside the jobs list.
  Source: `Control UI/cron: make the New Job sidebar collapsible`.
  Notes: 右侧可折叠「新建与说明」侧栏，引导至 Control UI / CLI；不在 clawkit 内嵌完整表单以免与 Gateway 校验分叉。

- [x] Link cron run history back to session chat.
  Source: older post-4.24 cron history deep-link work.
  Notes: `cron.runs` 条目中若有 `sessionKey`，提供「打开」跳转对话页并 `chat.history` 拉取。

- [x] Display explicit no-delivery cron jobs correctly.
  Source: `Cron/status: delivery.mode: "none" jobs as no-delivery previews`.
  Notes: `delivery.mode === "none"` 或 Gateway `deliveryPreviews` 的 `not requested` 显示「不投递」徽标与文案，避免误当作通道投递任务。

## P1: Status, Logs, And Performance

- [x] Add Gateway process uptime to status surfaces.
  Source: `Status: show compact Gateway process uptime and host system uptime`.
  Notes: OpenClaw 抽屉展示「Gateway 运行时长」，基于 WS `hello-ok.snapshot.uptimeMs`（见 `clawdbot/docs/gateway/index.md`）与本机时间推算。**主机系统 uptime** 仅在完整 `openclaw status` CLI 路径中汇总，当前 Gateway WS 未暴露给 clawkit，故未在 UI 显示。

- [x] Add recent restart handoffs to Gateway status.
  Source: `Gateway/status: show recent supervisor restart handoffs`.
  Notes: 调用 Gateway RPC `update.status` 的 `sentinel`（见 `clawdbot/docs/gateway/protocol.md`），以白话一行展示在 OpenClaw 抽屉；覆盖更新触发的重启记录而非全部 supervisor 事件。

- [x] Add dashboard/render diagnostics for slow UI frames.
  Source: `Control UI/performance: record browser long animation frame or long task entries`.
  Notes: OpenClaw 抽屉内可折叠「渲染诊断」：`PerformanceObserver` 采集 LoAF / Long Task（就绪后即订阅，面板用于查看与清空）；不支持时在文案中标明。

- [x] Keep slow Gateway/page calls async with local loading states.
  Source: Gateway/performance/startup and existing clawkit async page rules.
  Notes: keep using page shell first, then load metadata.

## P2: Talk, Pairing, And Voice

- [ ] Track `talk.session.*` RPC readiness for a future Talk panel.
  Source: shared Talk session controller and Gateway-managed `talk.session.*`.
  Notes: do not build voice UI until Gateway RPC schema is confirmed locally.

- [ ] Add copied setup-code parsing for Gateway pairing/binding.
  Source: iOS changelog: full copied setup-code messages and private LAN `ws://` handling.
  Notes: clawkit currently binds local desktop; useful if adding remote Gateway pairing.

- [ ] Keep non-loopback `ws://` blocked unless explicitly private/LAN-safe.
  Source: iOS pairing security note.
  Notes: relevant if clawkit adds remote Gateway pairing.

- [ ] Consider voice/TTS indicators only after text/session workflow is stable.
  Source: Talk/voice, telephony TTS override, realtime voice changes.
  Notes: lower priority for clawkit desktop unless user asks for Talk Mode.

## P2: Matrix

- [ ] Show Matrix encryption setup status if Matrix channel management lands in clawkit.
  Source: Matrix/E2EE setup and verification changelog.
  Notes: currently channel-specific; keep as future connection-page enhancement.

- [ ] Add Matrix verification action affordances only through Gateway/plugin commands.
  Source: Matrix SAS verification fixes.
  Notes: do not implement Matrix crypto locally in clawkit.

## Not Planned For ClawKit Unless Requested

- Plugin SDK internal migrations, runtime state helpers, fs-safe package APIs.
- QA/Mantis/Crabbox live test harness commands.
- Channel-specific routing fixes that are fully backend-owned and do not change Gateway UI/RPC surfaces.
- iOS app build hygiene, StoreKit receipt changes, Watch/Widget source hygiene.
- Provider backend fixes that only change model inference internals and expose no UI surface.

