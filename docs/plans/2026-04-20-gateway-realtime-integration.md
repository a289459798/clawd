# Gateway Realtime Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn clawkit from a local snapshot viewer into a full OpenClaw realtime desktop workbench with live session status, streaming output, real send/stop controls, realtime usage updates, and robust fallback behavior.

**Architecture:** Keep the current local snapshot loader as a fallback baseline, then add a dedicated Gateway realtime layer on top. The first-class runtime source should become Gateway WebSocket events for session activity, chat streaming, and usage updates, while file-based snapshot loading remains the cold-start and reconnect recovery path.

**Tech Stack:** Tauri 2, React 19, TypeScript, Vite 7, Rust command bridge, OpenClaw Gateway WebSocket RPC/events.

---

## Phase 0: Confirm protocol and state model

### Task 1: Document the exact Gateway surfaces clawkit will consume

**Files:**
- Create: `docs/plans/notes-gateway-events.md`
- Read: `/Users/zhangzy/Workspace/nodejs/clawdbot/docs/gateway/protocol.md`
- Read: `/Users/zhangzy/Workspace/nodejs/clawdbot/src/tui/tui-event-handlers.ts`
- Read: `/Users/zhangzy/Workspace/nodejs/clawdbot/src/tui/tui.ts`

**Step 1:** Capture the exact RPC methods and event families clawkit needs:
- `chat.history`
- `chat.send`
- `chat.abort`
- `sessions.list`
- `sessions.usage`
- `session_info_update`
- `usage_update`
- chat streaming/final/error events

**Step 2:** Write down the runtime state vocabulary clawkit should use:
- `idle`
- `sending`
- `waiting`
- `streaming`
- `running`
- `error`
- `aborted`

**Step 3:** Define which UI surfaces depend on which event.

**Step 4:** Save the note so later work does not re-discover protocol assumptions.

---

## Phase 1: Build Gateway connectivity without replacing existing snapshot flow

### Task 2: Add a frontend Gateway connection module

**Files:**
- Create: `src/lib/gatewayClient.ts`
- Create: `src/types/gateway.ts`

**Step 1:** Define typed payloads for:
- session usage summary
- chat event delta/final/error/aborted
- session info update
- usage update
- connection lifecycle events

**Step 2:** Implement a small WebSocket client wrapper that can:
- connect
- reconnect with backoff
- send RPC requests
- route pushed events to subscribers
- expose connection status

**Step 3:** Keep the module UI-agnostic.

### Task 3: Add a runtime hook layer

**Files:**
- Create: `src/hooks/useGatewayConnection.ts`
- Create: `src/hooks/useGatewaySessionRuntime.ts`

**Step 1:** Expose connection state:
- disconnected
- connecting
- connected
- reconnecting
- error

**Step 2:** Expose per-session runtime state:
- activity status
- active run id
- last event timestamp
- streaming draft text
- latest usage totals

**Step 3:** Keep snapshot state and runtime state separate so runtime can overlay snapshot data.

---

## Phase 2: Realtime list page

### Task 4: Overlay realtime state onto conversation cards

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`

**Step 1:** Stop using heuristic-only list status when runtime activity is available.

**Step 2:** Use runtime priority for state mapping:
- `sending|waiting|streaming|running` → `进行中`
- runtime terminal state after response → `已完成`
- no activity for >30 min → `空闲中`

**Step 3:** Make sorting prefer runtime activity over static inference.

**Step 4:** Realtime update the last reply summary as streaming content arrives.

### Task 5: Realtime usage in the list

**Files:**
- Modify: `src/App.tsx`

**Step 1:** Replace the current token source with a merged source:
- cold start: `sessions.json` snapshot totals
- live runtime: `usage_update` / `sessions.usage`

**Step 2:** Keep `19.4K` compact formatting.

**Step 3:** Handle stale/missing totals without blanking the row.

---

## Phase 3: Realtime detail page

### Task 6: Replace preview-only detail with history + live stream merging

**Files:**
- Modify: `src/App.tsx`
- Create: `src/lib/sessionHistoryMerge.ts`

**Step 1:** Load initial history with `chat.history`.

**Step 2:** Merge streaming delta text into a temporary in-progress assistant message.

**Step 3:** On final event, replace the draft with the finalized assistant message.

**Step 4:** On abort/error, show terminal state cleanly.

### Task 7: Realtime usage in detail page

**Files:**
- Modify: `src/App.tsx`

**Step 1:** Show snapshot usage immediately.

**Step 2:** Upgrade values live from usage events.

**Step 3:** Keep split counters visible:
- input
- output
- cacheRead
- cacheWrite
- total

---

## Phase 4: Real send / stop controls

### Task 8: Wire the composer to `chat.send`

**Files:**
- Modify: `src/App.tsx`
- Create: `src/lib/chatActions.ts`

**Step 1:** Replace the disabled composer with a real send flow.

**Step 2:** On send:
- create optimistic user message
- call `chat.send`
- bind returned run/session identifiers
- hand off to streaming state

**Step 3:** Keep the UI resilient if send fails.

### Task 9: Add stop-generation support

**Files:**
- Modify: `src/App.tsx`

**Step 1:** Show a stop button only when the session has active runtime activity.

**Step 2:** Call `chat.abort` with the active run/session identity.

**Step 3:** Reflect aborted state in both list and detail views.

---

## Phase 5: Recovery and fallback behavior

### Task 10: Keep local snapshot loading as reconnect/cold-start fallback

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/hooks/useGatewaySessionRuntime.ts`

**Step 1:** On cold start, load snapshot first.

**Step 2:** When Gateway connects, overlay runtime state.

**Step 3:** On disconnect, keep last known data visible and mark runtime stale.

**Step 4:** On reconnect, refetch current history/usage for visible sessions.

### Task 11: Surface connection health in UI

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`

**Step 1:** Add a subtle connection indicator.

**Step 2:** Show when the UI is running on:
- live Gateway
- reconnecting
- snapshot fallback only

---

## Phase 6: Refactor for maintainability

### Task 12: Split current monolithic App.tsx

**Files:**
- Create: `src/components/ConversationList.tsx`
- Create: `src/components/ConversationCard.tsx`
- Create: `src/components/ConversationDetail.tsx`
- Create: `src/components/AgentSidebar.tsx`
- Create: `src/components/StatusBadge.tsx`
- Create: `src/components/ConnectionIndicator.tsx`
- Modify: `src/App.tsx`

**Step 1:** Extract list rendering.

**Step 2:** Extract detail rendering.

**Step 3:** Extract runtime-state presentation helpers.

**Step 4:** Keep data orchestration in a smaller top-level container.

---

## Phase 7: Documentation and validation

### Task 13: Update user-facing docs

**Files:**
- Modify: `README.md`
- Modify: `PROJECT_STATUS.md`

**Step 1:** Document that clawkit now has Gateway realtime integration.

**Step 2:** Explain fallback behavior when Gateway is unavailable.

**Step 3:** Update status/runtime logic docs to remove old heuristic-only descriptions.

### Task 14: Validate with manual test matrix

**Files:**
- Create: `docs/plans/manual-test-matrix-gateway.md`

**Test scenarios:**
- Gateway connected on startup
- Gateway unavailable on startup
- reconnect after disconnect
- send message success
- send message failure
- streaming response updates list + detail
- stop generation
- usage updates appear in list + detail
- multiple sessions running simultaneously
- one session active while another remains idle

**Validation commands:**
- `pnpm build`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `pnpm tauri dev`

---

## Recommended execution order

1. Phase 0, lock protocol assumptions
2. Phase 1, add Gateway connection + runtime hooks
3. Phase 2, make list page realtime
4. Phase 3, make detail page realtime
5. Phase 4, wire real send + stop
6. Phase 5, fallback + reconnect
7. Phase 6, refactor structure
8. Phase 7, docs + validation

## Recommended implementation strategy

Use staged delivery, not big-bang replacement.

### Milestone A
- Gateway connection
- runtime session state
- realtime list page

### Milestone B
- realtime detail page
- live usage

### Milestone C
- real send
- stop generation
- reconnect recovery

### Milestone D
- refactor and polish
- docs sync
