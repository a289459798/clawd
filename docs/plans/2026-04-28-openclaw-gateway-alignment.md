# OpenClaw Gateway Alignment Development Guide

> Last updated: 2026-04-28
> Scope: clawkit desktop workbench integration with local OpenClaw.

## Goal

clawkit should behave as a local desktop workbench for OpenClaw, not as a parallel
implementation of OpenClaw session, agent, skill, or channel logic. The primary
integration contract is OpenClaw Gateway RPC/events. Local file reads are useful
for bootstrap and fallback, but they should not become the long-term source of
truth for session routing, store discovery, model selection, or runtime status.

## References

Use OpenClaw docs first, then source when a behavior needs implementation detail.

- `/Users/zhangzy/Workspace/nodejs/clawdbot/docs/gateway/protocol.md`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/docs/concepts/session.md`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/docs/cli/sessions.md`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/docs/gateway/configuration.md`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/docs/tools/skills.md`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/docs/tools/skills-config.md`

Useful source anchors:

- `/Users/zhangzy/Workspace/nodejs/clawdbot/src/gateway/protocol/schema/frames.ts`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/src/gateway/protocol/schema/logs-chat.ts`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/src/gateway/protocol/schema/sessions.ts`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/src/gateway/server-methods/chat.ts`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/src/gateway/server-methods/sessions.ts`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/src/config/sessions/paths.ts`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/src/config/sessions/combined-store-gateway.ts`

## Current State

clawkit already has a working Tauri + React shell with real Gateway messaging:

- Gateway WebSocket connect and request/response proxy exist in
  `src-tauri/src/gateway_proxy.rs`.
- `chat.history`, `chat.send`, `chat.abort`, `models.list`, `sessions.create`,
  and `sessions.patch` are wired through Tauri commands.
- The detail page can send text/images, stop generation, stream deltas, and
  refresh history after final events.
- The list page and realtime watcher still rely heavily on
  `load_openclaw_snapshot`, which reads local config/session files directly.

The main mismatch is that session state is now partly implemented by clawkit
itself. OpenClaw docs say session state is owned by the Gateway and UI clients
should query the Gateway for session data. That matters because OpenClaw's
session store resolution supports custom `session.store`, `{agentId}` templates,
canonical key migration, disk-only stores, retired agent dirs, and transcript
path containment rules.

## Target Architecture

### Source Of Truth

Use this precedence:

1. Gateway RPC/events for live and canonical data.
2. Local snapshot reads for cold-start fallback when Gateway is unavailable.
3. Direct config/session file mutation only when there is no Gateway method and
   the change is explicitly part of bootstrap.

### Data Flow

Startup:

1. Check OpenClaw install and binding status.
2. Connect to Gateway.
3. Load canonical agents, sessions, skills, channels, and models through RPC.
4. Fall back to `load_openclaw_snapshot` only if Gateway cannot serve the data.

Session list:

1. Call `sessions.list` with bounded params.
2. Use `sessions.preview` for lightweight transcript preview when needed.
3. Use `chat.history` for the active detail view.
4. Overlay `chat` and `sessions.changed` events on top of loaded rows.

Message sending:

1. If model changed, call `sessions.patch`.
2. Call `chat.send`.
3. Keep local optimistic messages while streaming.
4. On final/aborted/error, reconcile with `chat.history`.

Agent, skill, and channel views:

1. Prefer `agents.list` over direct `openclaw.json` parsing.
2. Prefer `skills.status` over directory scanning.
3. Prefer `channels.status` over config-only enabled flags.

## Gateway Method Map

Required now:

- `models.list`
- `agents.list`
- `sessions.list`
- `sessions.preview`
- `sessions.create`
- `sessions.patch`
- `chat.history`
- `chat.send`
- `chat.abort`

Likely next:

- `skills.status`
- `channels.status`
- `config.schema.lookup`
- config read/write methods for future settings UI

## Optimization Plan

### Phase 1: Add Typed Gateway Session RPCs

Add Rust commands for:

- `gateway_sessions_list`
- `gateway_sessions_preview`
- optionally `gateway_agents_list`

Keep payloads mostly as JSON first. Map to TypeScript types in `src/types/gateway.ts`
before converting them into existing `Agent` / `Conversation` view models.

Success criteria:

- Existing file-based snapshot still works.
- New commands can be called after `gateway_connect`.
- `pnpm build` and `cargo check --manifest-path src-tauri/Cargo.toml` pass.

### Phase 2: Prefer Gateway Sessions In Frontend

Introduce a frontend loader that tries Gateway first:

1. `gateway_connect`
2. `gateway_agents_list`
3. `gateway_sessions_list`
4. fallback `load_openclaw_snapshot`

Avoid deleting current snapshot parsing in the first pass. The first migration
should be additive, so regressions can fall back cleanly.

Success criteria:

- Conversation list comes from canonical Gateway rows when Gateway is available.
- Custom and templated session stores are no longer invisible to clawkit.
- Hidden/visible local UI state is preserved across refreshes.

### Phase 3: Replace Polling Realtime Watcher

The current watcher polls local snapshots every 900ms. Replace it with Gateway
subscriptions and event-driven refresh:

- Subscribe to `sessions.changed`.
- Refresh affected session rows through `sessions.list` or `sessions.preview`.
- Keep direct transcript polling only as an explicit fallback.

Success criteria:

- No periodic disk scan during normal connected operation.
- List summaries and token usage still update after chat turns.
- Disconnect/reconnect leaves the UI readable and marks status stale.

### Phase 4: Skills, Channels, And Config

Move secondary pages to Gateway surfaces:

- Skills page: `skills.status`
- Connections page: `channels.status`
- Future config UI: `config.schema.lookup` plus Gateway config mutation methods

Success criteria:

- Skill enablement reflects OpenClaw runtime behavior, not only directory
  presence.
- Channel status reflects health/probe state, not only config flags.
- Config edits stay schema-aware.

## Risks And Guardrails

- Do not remove file fallback until Gateway RPC parity is verified.
- Do not duplicate OpenClaw key normalization or session store discovery in
  clawkit. Treat Gateway rows as canonical.
- Do not add `model` to `chat.send`; OpenClaw schema does not accept it. Use
  `sessions.patch` before sending.
- Do not rely on config paths only. OpenClaw supports `OPENCLAW_CONFIG_PATH` and
  `session.store` overrides.
- Keep optimistic UI state isolated from canonical session rows so refreshes do
  not erase in-flight messages.

## Verification

After each phase:

- `pnpm build`
- `cargo check --manifest-path src-tauri/Cargo.toml`

Manual regression:

- Start with Gateway running and verify session list loads.
- Start with Gateway stopped and verify fallback/bootstrap behavior.
- Create a new session from an agent.
- Send a text message.
- Send an image-only message.
- Stop generation.
- Switch model and send.
- Hide and restore a conversation in the workbench.

## Immediate Next Step

Implement Phase 1 with the smallest possible patch:

1. Add Rust commands for `sessions.list`, `sessions.preview`, and `agents.list`.
2. Add matching TypeScript result types.
3. Keep existing UI behavior unchanged.
4. Verify both builds.

This gives clawkit the canonical Gateway surfaces before changing list rendering.
