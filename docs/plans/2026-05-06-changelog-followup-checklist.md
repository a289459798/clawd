# Changelog Follow-Up Checklist

> Last updated: 2026-05-06

This checklist is based on OpenClaw changelog items after 2026.4.24 from:

- `/Users/zhangzy/Workspace/nodejs/clawdbot/CHANGELOG.md`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/apps/ios/CHANGELOG.md`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/extensions/matrix/CHANGELOG.md`

Scope: only track items that make sense for clawx as a local desktop workbench. Channel-runtime internals, plugin SDK internals, iOS-only build hygiene, and provider-specific backend fixes stay out unless they change clawx user-facing behavior.

## Already Landed In This Pass

- [x] Parse OpenClaw inbound media markers such as `[media attached: /path/file.xlsx (mime)]` into file attachment parts.
- [x] Render file attachments as clickable attachment cards in chat history and the focused user-message summary.
- [x] Allow opening OpenClaw media files through Tauri opener with scoped `$HOME/.openclaw/media/**` permission.
- [x] Send non-image attachments through the Gateway attachment payload instead of treating every file as an image.
- [x] Display selected agent runtime on sessions and support runtime filtering in clawx session list.
- [x] Map Gateway session runtime states (`running`, `done`, `failed`, `timeout`, `killed`) to distinct clawx UI statuses.
- [x] Persist model and thinking changes through `sessions.patch` before `chat.send`.
- [x] Stop passing schema-extra thinking fields through `chat.send`.
- [x] Reconcile Gateway ack `runId` back into local conversation runtime so stop/realtime matching stays aligned.

## P0: Chat And Session UX

- [ ] Collapse consecutive duplicate text-only messages into one bubble with a count.
  Source: `Control UI/chat: collapse consecutive duplicate text messages`.
  Notes: implement in normalized message rendering, not in stored history.

- [ ] Hide heartbeat/no-op events from all visible transcript modes.
  Source: `Control UI/chat: suppress HEARTBEAT_OK acknowledgement history, streams, deltas, and final events`.
  Notes: current internal-message filter handles some cases; audit streaming deltas/finals and snapshot previews.

- [ ] Add filtered-empty vs genuinely-empty states for session list search/runtime filters.
  Source: `Control UI: distinguishing filtered-empty session lists from genuinely empty session stores`.
  Notes: current empty state says there are no visible conversations even when filters may be hiding rows.

- [ ] Add visual feedback for repeated actions.
  Source: `Control UI: announce session switches, flash active session selector, show inline Save/Apply/Update progress`.
  Notes: useful for session switch, title save, model/thinking patch, hide/restore.

- [ ] Keep the composer/control row responsive at narrow widths.
  Source: `Control UI/chat: keep chat controls/composer responsive across phone/tablet/desktop widths`.
  Notes: desktop app still needs narrow-window behavior on macOS/Windows.

- [ ] Hide or compact the chat controls row while scrolling down long transcripts.
  Source: `Control UI/chat: hide that row while scrolling down the transcript`.
  Notes: only if it improves clawx's desktop workbench feel; keep composer discoverable.

## P0: Gateway Reconciliation And Robustness

- [ ] Treat canonical session aliases and emitted session keys as the same active run.
  Source: `Control UI/chat: keep live replies visible when a raw session alias such as main sends the chat turn but Gateway emits events under the canonical session key`.
  Notes: add alias mapping around `activeConversationId`, realtime events, and optimistic rows.

- [ ] Handle queued same-session follow-up turns without false `ReplyRunAlreadyActiveError` UI states.
  Source: `Gateway/chat: clear the active reply-run guard before draining queued same-session follow-up turns`.
  Notes: clawx already queues while active; verify Gateway ack/final ordering and auto-send next queued item.

- [ ] Refresh exact active session rows instead of hydrating stale large stores.
  Source: `TUI/sessions: bound the session picker to recent rows and use exact lookup-style refreshes for the active session`.
  Notes: use `chat.history`/targeted preview after send/final where possible.

- [ ] Show session cleanup/orphan state if Gateway exposes it.
  Source: `CLI/sessions: prune old unreferenced transcript, compaction checkpoint, and trajectory artifacts`.
  Notes: likely a maintenance/doctor action in clawx, not direct file scanning.

## P1: Models And Auth

- [ ] Add model auth profile visibility.
  Source: `Models/auth: add openclaw models auth list [--provider <id>] [--json]`.
  Notes: prefer Gateway/RPC when available; otherwise visible CLI command with async Tauri command.

- [ ] Show session-scoped wording around model changes.
  Source: Telegram/Mattermost model picker wording: model picker changes session model, runtime switch is separate.
  Notes: composer model selector should make clear it changes the current session, not agent defaults.

- [ ] Add blocked-model repair guidance when a model is not in the allowlist.
  Source: `Model switching: include the exact additive allowlist repair command`.
  Notes: surface actionable command or config path when `sessions.patch` model fails.

- [ ] Ensure thinking picker comes from provider policy even when plugin registry is not active.
  Source: `Thinking/providers` and `Providers/DeepSeek` lightweight policy entries.
  Notes: current options come from session rows; add fallback from Gateway model/provider policy when exposed.

- [ ] Add Codex audio transcription capability display.
  Source: `OpenAI/Codex media: advertise Codex audio transcription`.
  Notes: model/provider page can show audio transcription capability when Gateway metadata exposes it.

## P1: Channels, Plugins, And Diagnostics

- [ ] Improve channel status degradation display.
  Source: `Discord/status: degraded transport and event-loop starvation signals in channels status/status --deep`.
  Notes: map channel health states into connection cards with clear "running but degraded" language.

- [ ] Surface plugin packaging diagnostics with repair actions.
  Source: source-only TypeScript package warnings and official-plugin install hints.
  Notes: skills/connections pages should show update/reinstall/disable suggestions, not raw plugin load text.

- [ ] Surface SecretRef/config contract readiness for externalized plugins.
  Source: external channel contracts under `dist/` and SecretRef preservation.
  Notes: connection setup should distinguish "configured secret missing" from "plugin contract missing".

- [ ] Add Weixin external plugin install/update affordance.
  Source: `@tencent-weixin/openclaw-weixin` external catalog entry pinned in changelog.
  Notes: clawx already has WeChat status; next step is guided install/update using official plugin id.

## P1: Cron And Automation

- [ ] Add cron list page or panel filtered by agent.
  Source: `openclaw cron list --agent <id>`.
  Notes: should use Gateway/CLI canonical data; no direct cron file parsing.

- [ ] Make the new cron job form collapsible beside the jobs list.
  Source: `Control UI/cron: make the New Job sidebar collapsible`.
  Notes: keep desktop workflow dense; avoid large dashboard layout.

- [ ] Link cron run history back to session chat.
  Source: older post-4.24 cron history deep-link work.
  Notes: use session key from canonical cron run rows when exposed.

- [ ] Display explicit no-delivery cron jobs correctly.
  Source: `Cron/status: delivery.mode: "none" jobs as no-delivery previews`.
  Notes: avoid misleading channel badges for no-delivery jobs.

## P1: Status, Logs, And Performance

- [ ] Add Gateway process uptime and host uptime to status surfaces.
  Source: `Status: show compact Gateway process uptime and host system uptime`.
  Notes: good fit for top gateway banner or settings/status popover.

- [ ] Add recent restart handoffs to Gateway status.
  Source: `Gateway/status: show recent supervisor restart handoffs`.
  Notes: useful when users wonder why Gateway briefly disconnected.

- [ ] Add dashboard/render diagnostics for slow UI frames.
  Source: `Control UI/performance: record browser long animation frame or long task entries`.
  Notes: likely debug-only panel/event log.

- [ ] Keep slow Gateway/page calls async with local loading states.
  Source: Gateway/performance/startup and existing clawx async page rules.
  Notes: keep using page shell first, then load metadata.

## P2: Talk, Pairing, And Voice

- [ ] Track `talk.session.*` RPC readiness for a future Talk panel.
  Source: shared Talk session controller and Gateway-managed `talk.session.*`.
  Notes: do not build voice UI until Gateway RPC schema is confirmed locally.

- [ ] Add copied setup-code parsing for Gateway pairing/binding.
  Source: iOS changelog: full copied setup-code messages and private LAN `ws://` handling.
  Notes: clawx currently binds local desktop; useful if adding remote Gateway pairing.

- [ ] Keep non-loopback `ws://` blocked unless explicitly private/LAN-safe.
  Source: iOS pairing security note.
  Notes: relevant if clawx adds remote Gateway pairing.

- [ ] Consider voice/TTS indicators only after text/session workflow is stable.
  Source: Talk/voice, telephony TTS override, realtime voice changes.
  Notes: lower priority for clawx desktop unless user asks for Talk Mode.

## P2: Matrix

- [ ] Show Matrix encryption setup status if Matrix channel management lands in clawx.
  Source: Matrix/E2EE setup and verification changelog.
  Notes: currently channel-specific; keep as future connection-page enhancement.

- [ ] Add Matrix verification action affordances only through Gateway/plugin commands.
  Source: Matrix SAS verification fixes.
  Notes: do not implement Matrix crypto locally in clawx.

## Not Planned For Clawx Unless Requested

- Plugin SDK internal migrations, runtime state helpers, fs-safe package APIs.
- QA/Mantis/Crabbox live test harness commands.
- Channel-specific routing fixes that are fully backend-owned and do not change Gateway UI/RPC surfaces.
- iOS app build hygiene, StoreKit receipt changes, Watch/Widget source hygiene.
- Provider backend fixes that only change model inference internals and expose no UI surface.

