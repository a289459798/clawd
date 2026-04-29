# Clawx Product Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Finish the core Clawx desktop experience so it is release-ready: no developer-machine assumptions, richer session browsing, Gateway-backed agent creation, and a better conversation detail workflow.

**Architecture:** Clawx remains a Tauri/React client and should not mutate OpenClaw files directly when a Gateway method exists. Gateway RPCs are the source of truth for agents, sessions, models, and session events; local snapshot reads stay as fallback only. UI state should preserve local interaction state while refreshing canonical Gateway data.

**Tech Stack:** Tauri 2, Rust command bridge, React 19, TypeScript, Vitest, OpenClaw Gateway WebSocket RPC.

---

## Product Principles

- No absolute developer paths in runtime code.
- Prefer OpenClaw Gateway RPCs over direct file reads.
- Preserve a useful offline/fallback state when Gateway is unavailable.
- Keep the primary UI focused: fast session scan, quick agent creation, low-friction chat.
- Avoid one-off UI branches that cannot be supported by Gateway data.

## Current Status

- Runtime hardcoded `/Users/zhangzy/clawd` has been removed from `src` and `src-tauri`.
- Session loading prefers Gateway `agents.list`, `sessions.list`, and `sessions.preview`.
- Local snapshot still supplies fallback skills/connections during migration.
- `sessions.changed` events refresh the Gateway snapshot.
- [x] Task 1: Conversation detail has Focus/Conversation modes; history side panel removed.
- [x] Task 2: Session list no longer truncates to 8 per agent or first 3 visible; search/sort added.
- [x] Task 3: Minimal Gateway-backed `agents.create` flow added.
- [x] Task 4: Detail live message subscription.
- [ ] Task 5: Session operations.
- [ ] Task 6: Tool timeline improvements.
- [ ] Task 7: Long conversation performance.
- [x] Task 8: Skills and connections Gateway migration.
- [x] Task 9: Usage dashboard.
- [ ] Task 10: Channel settings write-back forms.
- [ ] Task 11: Agent files editor and delete/update operations.

## 2026-04-29 Product Completion Pass

This pass implements the user-facing shell for the remaining OpenClaw parity
areas and removes the last development-machine skill path fallback.

### Agent Creation

- Use Gateway `agents.create` as the only writer for agent config and bootstrap
  files.
- Do not send `model` in the create payload. Models are selected per
  conversation in Clawx.
- Add a native workspace directory picker. The default suggestion still follows
  OpenClaw's convention: `~/.openclaw/workspace-<agentId>`.
- Follow-up: expose `agents.files.list/get/set` so the agent identity files
  can be reviewed and edited after creation.

### Skills

- Load from `skills.status` instead of scanning local OpenClaw source trees.
- Hide directory/source paths in the UI.
- Show skill description and dependency status.
- Use `skills.update` for enable/disable switches.

### Connections

- Load runtime status from `channels.status`.
- Show the full supported channel matrix from OpenClaw docs, including
  BlueBubbles, Discord, Feishu, Google Chat, LINE, Matrix, Mattermost, Teams,
  Telegram, WeChat, WhatsApp, Zalo, and others.
- Surface channel-specific setup hints:
  - Feishu: bot credentials under `channels.feishu`.
  - WeChat: external package `@tencent-weixin/openclaw-weixin`, channel id
    `openclaw-weixin`, QR login via Gateway web login methods.
- Follow-up: schema-driven config forms using `config.schema.lookup` and
  `config.patch`. The first implementation shows per-channel settings entry
  points and QR login, but does not yet write arbitrary channel config fields.

### Usage

- Add a Usage nav page backed by `sessions.usage`.
- Show totals for input/output/cache read/cache write/cost.
- Break down usage by Agent, model, and recent conversations.
- Follow-up: add date range controls, daily chart, provider/channel breakdown,
  and CSV export.

## Task 1: Conversation Detail Display Modes

**Files:**

- Modify: `src/components/ConversationWorkspace.tsx`
- Modify: `src/components/ConversationDetail.tsx`
- Modify: `src/App.css`

**Behavior:**

- Remove the separate history side panel.
- Add two display modes:
  - Focus mode: default, shows the current/last turn only.
  - Conversation mode: shows all visible messages in the session.
- Keep the composer, abort behavior, attachments, queued messages, and title editing unchanged.

**Verification:**

```bash
pnpm test
pnpm build
```

## Task 2: Session List Completeness

**Files:**

- Modify: `src/hooks/useGatewaySnapshot.ts`
- Modify: `src/lib/agentsSnapshot.ts`
- Modify: `src/lib/conversationSelectors.ts`
- Modify or create: session list filter/search components.

**Behavior:**

- Remove hardcoded “8 sessions per agent” and “first 3 visible” as the primary list policy.
- Load a larger bounded set from Gateway, initially `limit: 100`.
- Make visibility a UI filter, not a data-loss rule.
- Add search across title, session key, agent name, channel, label, and last message.
- Add list controls for:
  - all / active / recently updated
  - agent filter
  - sort by updated time, tokens, status
- Keep ResourceSidebar visibility toggles as a user pin/hide layer only.

**Verification:**

```bash
pnpm test
pnpm build
```

Manual checks:

- A user with more than 8 sessions can see them through pagination or scrolling.
- Hidden sessions do not disappear from searchable source data.
- Gateway unavailable still shows local fallback sessions.

## Task 3: Gateway-Backed Agent Creation

**Files:**

- Modify: `src-tauri/src/gateway_proxy.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types/gateway.ts`
- Create: `src/hooks/useAgents.ts`
- Create: `src/components/AgentCreateDialog.tsx`
- Modify: `src/components/ResourceSidebar.tsx`
- Modify: `src/App.tsx`

**Gateway Methods:**

- `agents.create`
- `agents.update`
- `agents.delete`
- `agents.files.list`
- `agents.files.get`
- `agents.files.set`

**Create Form:**

- Agent name
- Agent id preview generated from name.
- Workspace directory picker, not a free-form text field.
- Default workspace suggestion follows OpenClaw convention:
  `~/.openclaw/workspace-<agentId>`.
- Emoji/avatar optional

**Important design correction from 2026-04-29 review:**

- Agent creation should not bind a model. Model selection belongs to conversation
  send/session settings, not the agent create form.
- Root `/Users/zhangzy/Workspace/nodejs/clawdbot/BOOTSTRAP.md` does not exist.
  The canonical bootstrap template is
  `/Users/zhangzy/Workspace/nodejs/clawdbot/docs/reference/templates/BOOTSTRAP.md`.
- OpenClaw bootstrapping seeds `AGENTS.md`, `BOOTSTRAP.md`, `IDENTITY.md`,
  `USER.md`, and later writes identity/preferences into `IDENTITY.md`,
  `USER.md`, and `SOUL.md`.
- Workspace files live on the Gateway host. This matters for future remote
  Gateway support: Clawx should use Gateway methods for workspace creation and
  file access rather than assuming local filesystem access.
- Official architecture docs say control-plane clients connect to the Gateway
  over WebSocket; Gateway owns provider connections and typed request/event
  flow. Events are not replayed, so clients must refresh on gaps.
- Before implementing the final create flow, confirm whether Clawx should:
  1. use `agents.create` as-is and add a Gateway-side directory picker/file API,
  2. add a Clawx-specific Gateway helper for suggested workspace roots, or
  3. shell out to `openclaw agents add` only as a temporary fallback.

**Behavior:**

- Create through Gateway only.
- After creation, refresh `agents.list`/session snapshot.
- Show Gateway validation errors inline.
- Do not write `openclaw.json` directly from Clawx.
- Do not expose model binding in the Agent create form.

**Verification:**

```bash
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

Manual checks:

- Create an agent.
- Confirm it appears in ResourceSidebar.
- Confirm OpenClaw web/control UI sees the same agent.

## Task 4: Conversation Detail Gateway Events

**Files:**

- Modify: `src-tauri/src/gateway_proxy.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/realtime.ts`
- Modify: `src/App.tsx`
- Modify: `src/hooks/useGatewayChat.ts`

**Gateway Methods:**

- `sessions.messages.subscribe`
- `sessions.messages.unsubscribe`

**Behavior:**

- Subscribe to message events when a conversation opens.
- Unsubscribe when switching conversations or leaving detail.
- Use `chat.history` as initial load, then message events as live updates.
- Keep snapshot refresh for list metadata only.

**Verification:**

```bash
pnpm test
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

Manual checks:

- Open an active session and see streamed updates without reopening.
- Switch sessions and confirm updates do not leak between details.

## Task 5: Session Operations

**Files:**

- Modify: `src-tauri/src/gateway_proxy.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/components/ConversationDetail.tsx`
- Modify: `src/App.tsx`

**Gateway Methods:**

- `sessions.patch`
- `sessions.reset`
- `sessions.delete`
- `sessions.compact`
- Existing `chat.abort`

**Behavior:**

- Add a compact action menu in detail header:
  - copy session key
  - rename
  - compact
  - reset
  - delete
- Destructive actions require confirmation.
- Refresh session list after mutations.

**Verification:**

```bash
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Task 6: Tool Timeline Improvements

**Files:**

- Modify: `src/components/ConversationMessageList.tsx`
- Modify: `src/lib/toolStream.ts`
- Modify: `src/App.css`

**Behavior:**

- Render tool calls/results as collapsible timeline items.
- Show tool name, status, short argument summary, output summary, and error state.
- Preserve raw details behind expand controls.

**Verification:**

```bash
pnpm test
pnpm build
```

## Task 7: Long Conversation Performance

**Files:**

- Modify: `src/components/ConversationMessageList.tsx`
- Modify: `src/components/ConversationDetail.tsx`
- Modify: `src/hooks/useConversationAutoScroll.ts`

**Behavior:**

- Avoid rendering huge histories at once in conversation mode.
- Start with a simple “load earlier messages” window before introducing a virtualization dependency.
- Preserve auto-scroll only when the user is near the bottom.

**Verification:**

```bash
pnpm build
```

Manual checks:

- A long session remains responsive.
- Jump-to-bottom remains reliable.

## Task 8: Skills And Connections Gateway Migration

**Files:**

- Modify: `src-tauri/src/gateway_proxy.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types/gateway.ts`
- Modify: `src/hooks/useGatewaySnapshot.ts`
- Modify: `src/components/InfoPages.tsx`

**Gateway Methods:**

- `skills.status`
- Channel/status methods available from OpenClaw schema or `config.schema.lookup`

**Behavior:**

- Prefer Gateway-backed skill status.
- Prefer Gateway/config-schema-backed channel connection status.
- Keep local snapshot fallback while methods are unavailable.

**Verification:**

```bash
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Suggested Order

1. Detail display modes.
2. Session list completeness.
3. Agent create flow.
4. Detail live message subscription.
5. Session operations.
6. Tool timeline polish.
7. Long conversation performance.
8. Skills/connections Gateway migration.
