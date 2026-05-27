# Gateway Sessions Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move clawkit conversation data loading from direct OpenClaw session file reads to canonical Gateway session RPCs while preserving the current fallback behavior.

**Architecture:** Add a thin adapter layer that converts Gateway `agents.list` and `sessions.list` rows into the existing `OpenClawSnapshot` shape, then switch the frontend loader to try Gateway first and fall back to `load_openclaw_snapshot`. Keep UI rendering and message sending unchanged until the new data path is verified.

**Tech Stack:** Tauri 2, Rust command bridge, React 19, TypeScript, OpenClaw Gateway WebSocket RPC.

---

## Context

Read this first:

- `docs/plans/2026-04-28-openclaw-gateway-alignment.md`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/docs/gateway/protocol.md`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/docs/concepts/session.md`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/docs/cli/sessions.md`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/src/gateway/protocol/schema/sessions.ts`
- `/Users/zhangzy/Workspace/nodejs/clawdbot/src/gateway/server-methods/sessions.ts`

Current in-progress foundation:

- `src-tauri/src/gateway_proxy.rs` has commands for `gateway_agents_list`,
  `gateway_sessions_list`, and `gateway_sessions_preview`.
- `src-tauri/src/lib.rs` registers those commands.
- `src/types/gateway.ts` has initial Gateway agents/sessions types.

Progress as of 2026-04-28:

- [x] Task 1: Adapter tests and Vitest script added.
- [x] Task 2: Gateway-to-snapshot adapter implemented.
- [x] Task 3: `useGatewaySnapshot` loader added.
- [x] Task 4: App startup prefers Gateway snapshot.
- [x] Task 5: Local skills/connections are preserved as fallback metadata.
- [x] Task 6: `sessions.preview` is merged into conversation previews.
- [x] Task 7: `sessions.subscribe`/`sessions.unsubscribe` wrappers added and
  `clawkit://sessions-changed` refreshes the Gateway snapshot.
- [ ] Task 8: Move skills and channels to dedicated Gateway methods.

Verification:

- `pnpm test`
- `pnpm build`
- `cargo check --manifest-path src-tauri/Cargo.toml`

Do not remove `load_openclaw_snapshot` in this migration. It remains the cold
start and Gateway-unavailable fallback.

## Task 1: Add Gateway-To-Snapshot Adapter Tests

**Files:**

- Create: `src/lib/gatewaySnapshotAdapter.test.ts`
- Create: `src/lib/gatewaySnapshotAdapter.ts`
- Modify: `package.json` if a test script is missing

**Step 1: Inspect test setup**

Run:

```bash
cat package.json
rg -n "vitest|test" .
```

Expected:

- If Vitest is already configured, use it.
- If not configured, add a minimal `test` script using `vitest run` and add
  `vitest` as a dev dependency only if already present in the lock or needed.

**Step 2: Write the failing adapter test**

Create `src/lib/gatewaySnapshotAdapter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSnapshotFromGatewayRows } from "./gatewaySnapshotAdapter";
import type { GatewayAgentsListResult, GatewaySessionsListResult } from "../types/gateway";

describe("buildSnapshotFromGatewayRows", () => {
  it("maps Gateway agents and sessions into the existing snapshot shape", () => {
    const agents: GatewayAgentsListResult = {
      defaultId: "main",
      agents: [
        {
          id: "main",
          name: "Main Agent",
          workspace: "/tmp/workspace",
          model: { primary: "openai/gpt-5.4" },
        },
      ],
    };
    const sessions: GatewaySessionsListResult = {
      sessions: [
        {
          key: "agent:main:main",
          sessionId: "sess-1",
          label: "Daily Work",
          derivedTitle: "First user question",
          lastMessagePreview: "Assistant answer",
          updatedAt: 1710000000000,
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          totalTokensFresh: true,
          modelProvider: "openai",
          model: "gpt-5.4",
        },
      ],
    };

    const snapshot = buildSnapshotFromGatewayRows({ agents, sessions });

    expect(snapshot.agents).toEqual([
      {
        id: "main",
        name: "Main Agent",
        workspace: "/tmp/workspace",
        model: "openai/gpt-5.4",
      },
    ]);
    expect(snapshot.sessions[0]).toMatchObject({
      id: "sess-1",
      agent_id: "main",
      key: "agent:main:main",
      title: "Daily Work",
      label: "Daily Work",
      last_message: "Assistant answer",
      updated_at: 1710000000000,
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
      total_tokens_fresh: true,
    });
    expect(snapshot.sessions[0]?.preview_messages).toEqual([
      { role: "assistant", text: "Assistant answer" },
    ]);
  });

  it("falls back to derived title, display name, key, and agent id parsing", () => {
    const snapshot = buildSnapshotFromGatewayRows({
      agents: { agents: [{ id: "work" }] },
      sessions: {
        sessions: [
          {
            key: "agent:work:topic:abc",
            derivedTitle: "Derived",
            updatedAt: null,
          },
        ],
      },
    });

    expect(snapshot.agents[0]?.name).toBe("work");
    expect(snapshot.sessions[0]).toMatchObject({
      agent_id: "work",
      title: "Derived",
      updated_at: undefined,
    });
  });
});
```

**Step 3: Run the failing test**

Run:

```bash
pnpm test -- src/lib/gatewaySnapshotAdapter.test.ts
```

Expected:

- FAIL because `gatewaySnapshotAdapter.ts` does not export
  `buildSnapshotFromGatewayRows` yet.

## Task 2: Implement The Adapter

**Files:**

- Modify: `src/lib/gatewaySnapshotAdapter.ts`
- Test: `src/lib/gatewaySnapshotAdapter.test.ts`

**Step 1: Write the minimal implementation**

Implement:

```ts
import type {
  GatewayAgentsListResult,
  GatewaySessionRow,
  GatewaySessionsListResult,
  OpenClawSnapshot,
  SnapshotSession,
} from "../types/gateway";

function agentIdFromSessionKey(key: string): string {
  const match = key.match(/^agent:([^:]+)/);
  return match?.[1] ?? "main";
}

function sessionTitle(row: GatewaySessionRow): string {
  return row.label || row.displayName || row.derivedTitle || row.subject || row.key;
}

function compactModel(row: GatewaySessionRow): string | undefined {
  if (row.modelProvider && row.model) {
    return `${row.modelProvider}/${row.model}`;
  }
  return row.model;
}

export function buildSnapshotFromGatewayRows(params: {
  agents: GatewayAgentsListResult;
  sessions: GatewaySessionsListResult;
}): OpenClawSnapshot {
  const agents = (params.agents.agents ?? []).map((agent) => ({
    id: agent.id,
    name: agent.name ?? agent.identity?.name ?? agent.id,
    workspace: agent.workspace,
    model: agent.model?.primary,
  }));

  const sessions: SnapshotSession[] = (params.sessions.sessions ?? []).map((row) => {
    const lastMessage = row.lastMessagePreview;
    return {
      id: row.sessionId ?? row.key,
      agent_id: agentIdFromSessionKey(row.key),
      key: row.key,
      title: sessionTitle(row),
      label: row.label,
      updated_at: row.updatedAt ?? undefined,
      channel: row.channel ?? row.lastChannel,
      last_message: lastMessage,
      last_role: lastMessage ? "assistant" : undefined,
      input_tokens: row.inputTokens,
      output_tokens: row.outputTokens,
      total_tokens: row.totalTokens,
      total_tokens_fresh: row.totalTokensFresh,
      estimated_cost_usd: row.estimatedCostUsd,
      preview_messages: lastMessage
        ? [
            {
              role: "assistant",
              text: lastMessage,
              model: compactModel(row),
              provider: row.modelProvider,
            },
          ]
        : [],
    };
  });

  return {
    agents,
    sessions,
    connections: [],
    skills: [],
  };
}
```

**Step 2: Run adapter test**

Run:

```bash
pnpm test -- src/lib/gatewaySnapshotAdapter.test.ts
```

Expected:

- PASS.

**Step 3: Run full frontend build**

Run:

```bash
pnpm build
```

Expected:

- PASS.

## Task 3: Add Gateway Snapshot Loader Hook

**Files:**

- Create: `src/hooks/useGatewaySnapshot.ts`
- Modify: `src/types/gateway.ts` only if stricter response typing is needed

**Step 1: Write the hook**

Create a UI-agnostic helper hook/function that can be used from `App.tsx`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { buildSnapshotFromGatewayRows } from "../lib/gatewaySnapshotAdapter";
import type {
  GatewayAgentsListResult,
  GatewaySessionsListResult,
  OpenClawSnapshot,
} from "../types/gateway";

export async function loadGatewaySnapshot(): Promise<OpenClawSnapshot> {
  await invoke("gateway_connect");
  const [agents, sessions] = await Promise.all([
    invoke<GatewayAgentsListResult>("gateway_agents_list"),
    invoke<GatewaySessionsListResult>("gateway_sessions_list", {
      params: {
        limit: 100,
        includeDerivedTitles: true,
        includeLastMessage: true,
      },
    }),
  ]);
  return buildSnapshotFromGatewayRows({ agents, sessions });
}
```

**Step 2: Run build**

Run:

```bash
pnpm build
```

Expected:

- PASS.

## Task 4: Prefer Gateway Snapshot In App Startup

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/hooks/useGatewayRealtime.ts` only if the same fallback helper is reused there

**Step 1: Import the loader**

Add:

```ts
import { loadGatewaySnapshot } from "./hooks/useGatewaySnapshot";
```

**Step 2: Replace startup snapshot loading**

In the `loadSnapshot` function inside `src/App.tsx`, change this:

```ts
const snapshot = await invoke<OpenClawSnapshot>("load_openclaw_snapshot");
```

to:

```ts
let snapshot: OpenClawSnapshot;
try {
  snapshot = await loadGatewaySnapshot();
} catch (gatewayError) {
  console.warn("Gateway snapshot unavailable, falling back to local snapshot", gatewayError);
  snapshot = await invoke<OpenClawSnapshot>("load_openclaw_snapshot");
}
```

Keep the rest of `setAgents`, `setSkills`, and `setConnections` unchanged for
this task. Gateway snapshot will not populate skills/connections yet, so the
fallback-only data may be thinner. If that is too visible in the UI, load the
local snapshot only for skills/connections in a follow-up task.

**Step 3: Run build**

Run:

```bash
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected:

- Both PASS.

**Step 4: Manual check**

Run the app and verify:

- With Gateway running, conversation rows still appear.
- With Gateway stopped, bootstrap/fallback behavior still works.

## Task 5: Preserve Skills And Connections During Gateway Session Migration

**Files:**

- Modify: `src/hooks/useGatewaySnapshot.ts`
- Modify: `src/App.tsx`

**Step 1: Load local snapshot for secondary data**

Update startup logic so the canonical Gateway session data is merged with local
skills/connections until those pages move to dedicated Gateway methods:

```ts
const localSnapshot = await invoke<OpenClawSnapshot>("load_openclaw_snapshot");
let snapshot = localSnapshot;
try {
  const gatewaySnapshot = await loadGatewaySnapshot();
  snapshot = {
    ...gatewaySnapshot,
    connections: localSnapshot.connections,
    skills: localSnapshot.skills,
  };
} catch (gatewayError) {
  console.warn("Gateway snapshot unavailable, using local snapshot", gatewayError);
}
```

**Step 2: Run build**

Run:

```bash
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected:

- Both PASS.

## Task 6: Add `sessions.preview` For Better List Preview

**Files:**

- Modify: `src/hooks/useGatewaySnapshot.ts`
- Modify: `src/lib/gatewaySnapshotAdapter.ts`
- Modify: `src/lib/gatewaySnapshotAdapter.test.ts`

**Step 1: Extend adapter input**

Allow `buildSnapshotFromGatewayRows` to accept optional preview result.

**Step 2: Write failing test**

Add a test where `lastMessagePreview` is absent but `sessions.preview` returns
assistant text.

Expected mapped `preview_messages`:

```ts
[{ role: "assistant", text: "Preview assistant text" }]
```

**Step 3: Implement preview merge**

When row preview is missing, look up `preview.previews[]` by key and use the
last assistant item, else the last item.

**Step 4: Update loader**

After `sessions.list`, call `gateway_sessions_preview` for the first visible
keys only:

```ts
const keys = (sessions.sessions ?? []).slice(0, 50).map((session) => session.key);
const preview = keys.length > 0
  ? await invoke<GatewaySessionsPreviewResult>("gateway_sessions_preview", {
      params: { keys, limit: 12, maxChars: 240 },
    })
  : undefined;
```

**Step 5: Verify**

Run:

```bash
pnpm test -- src/lib/gatewaySnapshotAdapter.test.ts
pnpm build
```

Expected:

- PASS.

## Task 7: Replace Snapshot Polling With Gateway Session Events

**Files:**

- Modify: `src/hooks/useGatewayRealtime.ts`
- Modify: `src/App.tsx`
- Modify: `src-tauri/src/gateway_proxy.rs` only if `sessions.subscribe` needs a command wrapper

**Step 1: Add subscribe command if needed**

Add a generic wrapper or dedicated command for:

- `sessions.subscribe`
- `sessions.unsubscribe`

**Step 2: Listen for `clawkit://sessions-changed`**

`gateway_proxy.rs` already emits `clawkit://sessions-changed` for Gateway
`sessions.changed` events. Use that event to refresh Gateway snapshot instead of
polling local disk every 900ms.

**Step 3: Keep fallback polling only when Gateway is unavailable**

If Gateway connect fails, use current local polling behavior.

**Step 4: Verify**

Run:

```bash
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

Manual:

- Send a message and confirm list updates after final.
- Stop Gateway and confirm UI remains readable.
- Restart Gateway and confirm refresh resumes.

## Task 8: Move Skills And Channels To Gateway

**Files:**

- Modify: `src-tauri/src/gateway_proxy.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types/gateway.ts`
- Modify: `src/App.tsx` or create a focused hook

**Step 1: Add commands**

Add:

- `gateway_skills_status`
- `gateway_channels_status`

**Step 2: Add types**

Add minimal TypeScript result types based on OpenClaw docs/source.

**Step 3: Merge UI data**

Keep existing local snapshot data as fallback.

**Step 4: Verify**

Run:

```bash
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

Manual:

- Skills page still renders.
- Connections page displays more accurate status when Gateway is available.

## Completion Criteria

- Session list uses Gateway canonical rows when Gateway is available.
- Local snapshot fallback still works.
- No normal-operation 900ms disk polling when Gateway is connected.
- Skills/connections have a clear path to Gateway-backed status.
- All verification commands pass.

## Suggested Commit Sequence

1. `docs: plan gateway sessions migration`
2. `feat: add gateway session list adapter`
3. `feat: prefer gateway sessions snapshot`
4. `feat: refresh sessions from gateway events`
5. `feat: read skills and channels from gateway`
