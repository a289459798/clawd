# Notifications and Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add system notifications for completed conversations and introduce a durable ClawKit settings area covering general behavior, language, appearance, and selected OpenClaw integration preferences.

**Architecture:** Store ClawKit-owned UI preferences in `~/.clawkit/clawkit.json` through Tauri commands, while continuing to treat OpenClaw Gateway/config as the source of truth for OpenClaw runtime data. Add a settings page in the existing desktop workbench navigation, apply settings through React state/context, and keep slow or platform-specific work inside Tauri.

**Tech Stack:** React 19, TypeScript, Tauri 2, Rust, `@tauri-apps/plugin-notification`, `tauri-plugin-notification`, existing Gateway commands and `config.get`/`config.patch`.

---

## Implementation Status

Last updated: 2026-05-09.

### Completed

- Task 1: Settings types, defaults, merge helper, and focused tests.
  - Added `src/types/settings.ts`.
  - Added `src/lib/settingsDefaults.ts`.
  - Added `src/lib/settingsDefaults.test.ts`.
  - `mergeClawKitSettings(raw)` fills missing defaults, preserves unknown keys, and rejects invalid enum/boolean values back to defaults.
- Task 2: Tauri settings persistence commands.
  - Added `get_clawkit_settings()`.
  - Added `patch_clawkit_settings(patch)`.
  - Settings are read from and written to `~/.clawkit/clawkit.json`.
  - The command path is ClawKit-owned only and does not write OpenClaw config.
- Task 3: Frontend settings state hook.
  - Added `src/hooks/useClawKitSettings.ts`.
  - Defaults are available immediately before Tauri settings load finishes.
  - Patches are applied optimistically, reconciled from the Tauri command response, and rolled back on save failure.
  - `src/App.tsx` loads settings without blocking the app shell.
- Task 4: Settings navigation entry.
  - Added `settings` to `NavKey`.
  - Added a lower-left settings icon beside the OpenClaw status button.
  - Routed `activeNav === "settings"` to the settings page.
- Task 5: Settings page UI.
  - Added `src/components/SettingsPage.tsx`.
  - Added General, Appearance, Notifications, OpenClaw, and Advanced sections.
  - The page uses compact setting rows, segmented controls, toggles, and read-only status rows.
  - OpenClaw controls are currently display-only except for ClawKit-owned `openclaw.autoStartGateway`.
- Task 6: Default conversation display mode.
  - `ConversationWorkspace` accepts `defaultDisplayMode`.
  - New conversation detail openings initialize from `settings.general.defaultConversationMode`.
  - Inline display-mode toggles remain temporary for the current conversation view.
- Task 7: Appearance settings applied to the app shell.
  - Added `src/lib/appAppearance.ts`.
  - Added `src/lib/appAppearance.test.ts`.
- `App` now applies `data-theme`, `data-density`, `data-message-width`, `data-code-wrap`, and a `--app-font-size` CSS variable.
  - CSS now applies light/system theme variables, font scale, compact density, message width, and code wrapping behavior.
- Task 8: Notification plugin and frontend helper.
  - Added `@tauri-apps/plugin-notification`.
  - Added `tauri-plugin-notification`.
  - Registered `tauri_plugin_notification::init()` in the Tauri builder.
  - Added `notification:default` capability permission.
  - Added `src/lib/notifications.ts` and `src/lib/notifications.test.ts`.
- Task 9: Conversation completion notification detection.
  - Added `src/lib/conversationNotifications.ts`.
  - Added `src/lib/conversationNotifications.test.ts`.
  - `App` now detects transitions from an active/working conversation into `completed` or `failed`.
  - Startup-loaded terminal sessions are suppressed.
  - Notification keys are deduplicated by conversation, previous run id/start, and terminal timestamp.
  - Notification settings for enabled/disabled, only-unfocused, success/failure filtering, reply summary, and privacy mode are respected.
  - Notifications now include `id` and `extra.conversationId` metadata for action handling.
  - `App` listens to Tauri notification actions and opens the matching conversation after showing/unminimizing the main window.
- Task 10: Lightweight i18n layer for new UI.
  - Added `src/lib/i18n.ts`.
  - Added `src/lib/i18n.test.ts`.
  - Added `src/locales/zh-CN.ts`.
  - Added `src/locales/en-US.ts`.
  - Settings page labels, navigation labels, and notification fallback copy use the selected language.
- Task 11: OpenClaw settings actions.
  - Settings page now exposes refresh, reconnect, start/stop Gateway, repair binding, install OpenClaw, and update OpenClaw actions.
  - Actions reuse existing Tauri commands and visible terminal flows.
  - Default model/provider/channel management remains linked to the existing Models and Connections pages rather than adding raw config editors.
- General behavior preferences wired into app behavior.
  - Added `src/lib/composerShortcut.ts` and `src/lib/composerShortcut.test.ts`.
  - `general.sendShortcut` now controls whether Enter or Cmd/Ctrl+Enter sends from the conversation composer.
  - Added `src/lib/sessionConfirmations.ts` and `src/lib/sessionConfirmations.test.ts`.
  - `general.confirmDestructiveActions` now controls reset/delete confirmation prompts.
  - Added `src/lib/appUiPersistence.ts` and `src/lib/appUiPersistence.test.ts`.
  - `general.rememberConversationFilters` now persists sidebar search/runtime/sort state in local storage.
  - `general.restoreLastConversation` now restores the last active conversation after visible conversations load.
  - `general.autoCheckUpdates` now gates the periodic OpenClaw CLI/update status check.
  - `openclaw.autoStartGateway` now attempts to start Gateway once after OpenClaw is installed and ClawKit binding is configured.

### Verified

- `pnpm test -- src/lib/settingsDefaults.test.ts`
- `pnpm test -- src/lib/appAppearance.test.ts src/lib/notifications.test.ts src/lib/conversationNotifications.test.ts`
- `pnpm test -- src/lib/i18n.test.ts src/lib/conversationNotifications.test.ts`
- `pnpm test -- src/lib/composerShortcut.test.ts src/lib/sessionConfirmations.test.ts`
- `pnpm test -- src/lib/appUiPersistence.test.ts`
- `pnpm test -- src/lib/notifications.test.ts`
- `pnpm test` (24 files / 103 tests)
- `pnpm build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml && cargo check --manifest-path src-tauri/Cargo.toml`

### OpenClaw Source Alignment Checked

Checked against local OpenClaw source at `/Users/zhangzy/Workspace/nodejs/clawdbot`:

- `config.patch` requires `baseHash` and a JSON/JSON5 `raw` string.
- `config.get` returns the config snapshot/hash needed before patching OpenClaw config.
- `sessions.patch` is the canonical session-level update path for model/thinking/session metadata.
- OpenClaw config/state path resolution supports `OPENCLAW_CONFIG_PATH` and `OPENCLAW_STATE_DIR`; ClawKit must not assume only `~/.openclaw/openclaw.json`.

### Still Requires Manual Verification

- Task 12 manual regression, including notification permission flow and Windows follow-up checks.
- Notification click/action behavior on macOS and Windows.
- Settings page OpenClaw actions against a live Gateway instance.
- Gateway auto-start behavior on app launch.

### Partially Implemented / Deferred Behavior

- Existing large app pages remain mostly Chinese; i18n coverage currently targets navigation, settings, and notification fallback copy.
- Notification click handling is wired through Tauri `onAction`, but OS-level click foreground behavior still needs manual verification.
- Notification behavior has automated unit coverage, but the macOS permission prompt and Windows notification behavior still require manual verification.
- Settings page OpenClaw actions have build/type coverage, but still need a manual Gateway regression against a running OpenClaw instance.
- Advanced diagnostics are placeholder/read-only only.

---

## Product Scope

### 1. Conversation Completion Notifications

Show a native system notification when a conversation run reaches a terminal state.

Initial behavior:

- Notify when an active conversation changes from `working` to `completed`, `failed`, `error`, or `stopped`.
- Default enabled for `completed` and `failed/error`, disabled for `stopped` if the stop was user initiated.
- Notification title: conversation title or agent name.
- Notification body:
  - Completed: latest assistant reply summary, capped to a short single paragraph.
  - Failed/error: actionable error/status text when available.
- Clicking the notification should bring ClawKit main window to front and open the matching conversation when the notification API supports click handling.
- Do not notify for historical sessions loaded during startup reconciliation.
- Do not notify twice for the same run id or terminal timestamp.
- Respect user setting `notifications.conversationFinished`.

### 2. Settings Entry and Page

Add a settings icon at the lower-left navigation area, visually aligned with the existing OpenClaw status button.

Settings page sections:

- General
- Appearance
- Notifications
- OpenClaw
- Advanced

The page should feel like the existing tool UI: compact, durable, and form-driven. Avoid dashboard cards and marketing copy.

### 3. General Settings

Initial options:

- Default conversation display mode:
  - `focus`
  - `conversation`
- Language:
  - `auto`
  - `zh-CN`
  - `en-US`
- Send shortcut:
  - `enterToSend`
  - `modEnterToSend`
- Restore behavior:
  - restore last opened conversation on launch
  - keep sidebar conversation search/filter between launches
- Update behavior:
  - automatically check OpenClaw/ClawKit status on launch
- Destructive action confirmation:
  - keep confirmation prompts enabled for reset/delete/clear actions

### 4. Appearance Settings

Initial options:

- Theme:
  - `system`
  - `dark`
  - `light`
- Font size:
  - numeric UI base font size in px
  - current supported range: 12-20 px
- Interface density:
  - `comfortable`
  - `compact`
- Message layout:
  - code block line wrapping
  - message max width: `normal` / `wide`
- Sidebar behavior:
  - default resource sidebar width, if the existing layout later exposes resize.

### 5. OpenClaw Settings

Only expose ClawKit-friendly controls that either call Gateway methods or open existing visible terminal/browser flows. Do not create a parallel OpenClaw config editor.

Initial options/actions:

- OpenClaw CLI path display:
  - resolved path
  - installed version
  - update status
- Gateway connection:
  - current status
  - gateway URL/port
  - reconnect button
  - start/stop buttons using existing Gateway service commands
- Client binding:
  - current binding status
  - repair binding button using existing bootstrap command
- Config locations:
  - OpenClaw config path display
  - ClawKit home path display
  - open folder actions through Tauri/opener where safe
- Update/install actions:
  - reuse visible terminal flows already implemented for install/update
- Defaults link-out:
  - default model remains managed in Models page
  - provider credentials remain managed in Models page
  - channel/plugin setup remains managed in Connections page

Additional OpenClaw options worth considering after the first version:

- Default agent workspace, if Gateway exposes canonical update semantics.
- Gateway auto-start on app launch.
- Gateway reconnect interval.
- Snapshot fallback diagnostics.
- Session history reconciliation strategy, mostly diagnostic rather than user-facing.
- Model/thinking defaults, only if backed by Gateway/OpenClaw config patch semantics.

### 6. Notifications Settings

Initial options:

- Conversation finished notification:
  - enabled/disabled
  - notify only when ClawKit is not focused
  - notify on success
  - notify on failure
- Notification content:
  - include assistant reply summary
  - privacy mode: show generic “对话已完成” body
- Optional future:
  - sound setting if the notification plugin and platform support it consistently.

## Data Model

Create a ClawKit settings shape stored in `~/.clawkit/clawkit.json`.

Suggested initial shape:

```json
{
  "version": 1,
  "general": {
    "defaultConversationMode": "focus",
    "language": "auto",
    "sendShortcut": "modEnterToSend",
    "restoreLastConversation": false,
    "rememberConversationFilters": true,
    "autoCheckUpdates": true,
    "confirmDestructiveActions": true
  },
  "appearance": {
    "theme": "system",
    "fontSize": 15,
    "density": "comfortable",
    "codeWrap": false,
    "messageWidth": "normal"
  },
  "notifications": {
    "conversationFinished": true,
    "onlyWhenUnfocused": true,
    "notifyOnSuccess": true,
    "notifyOnFailure": true,
    "includeReplySummary": true,
    "privacyMode": false
  },
  "openclaw": {
    "autoStartGateway": false
  }
}
```

Rules:

- Merge missing keys with defaults at read time.
- Preserve unknown keys when writing.
- Write through a Tauri command, not direct frontend file access.
- Keep OpenClaw config writes separate and use Gateway/config patch with `baseHash`.
- Migrate old `clawx` localStorage keys only where needed, then remove them.

## Internationalization Plan

Implement a small local i18n layer first. Do not introduce a large framework until the app has enough translation surface to justify it.

Suggested files:

- Create: `src/lib/i18n.ts`
- Create: `src/locales/zh-CN.ts`
- Create: `src/locales/en-US.ts`

Behavior:

- `auto` resolves from system language if Tauri exposes it, otherwise `navigator.language`.
- Fallback order: selected language, system language, `zh-CN`.
- Initial translation coverage should include new settings page, notification text, nav labels, and common form labels.
- Existing large page copy can remain Chinese in the first pass, but new UI should use the i18n helper.

## Implementation Tasks

### Task 1: Define Settings Types and Defaults

**Files:**

- Create: `src/types/settings.ts`
- Create: `src/lib/settingsDefaults.ts`
- Test: `src/lib/settingsDefaults.test.ts`

**Steps:**

1. Add `ClawKitSettings` TypeScript type matching the data model.
2. Add `DEFAULT_CLAWKIT_SETTINGS`.
3. Add `mergeClawKitSettings(raw)` that recursively fills missing defaults while preserving valid user values.
4. Add tests for empty config, partial config, unknown keys, and invalid enum values.
5. Run: `pnpm test -- src/lib/settingsDefaults.test.ts`

### Task 2: Add Tauri Settings Commands

**Files:**

- Modify: `src-tauri/src/lib.rs`
- Test: manual through frontend commands for now.

**Steps:**

1. Add Rust structs for the settings payload or use `serde_json::Value` plus server-side default merge.
2. Add command `get_clawkit_settings()`.
3. Add command `patch_clawkit_settings(patch: Value)`.
4. Read/write `~/.clawkit/clawkit.json`.
5. Preserve unknown keys and keep `version`.
6. Keep file IO inside `spawn_blocking` if it grows beyond trivial operations.
7. Register both commands in `invoke_handler`.
8. Run: `cargo check --manifest-path src-tauri/Cargo.toml`.

### Task 3: Add Settings State Hook

**Files:**

- Create: `src/hooks/useClawKitSettings.ts`
- Modify: `src/App.tsx`

**Steps:**

1. Load settings after app shell starts.
2. Keep defaults available immediately before the Tauri command resolves.
3. Provide `settings`, `settingsLoading`, `settingsError`, and `patchSettings`.
4. Optimistically apply patches, then reconcile from the command result.
5. Show non-blocking errors in the settings page, not global app failure.
6. Run: `pnpm build`.

### Task 4: Add Settings Navigation

**Files:**

- Modify: `src/types/app.ts`
- Modify: `src/components/AppChrome.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`

**Steps:**

1. Add `"settings"` to `NavKey`.
2. Add a small settings icon button in the left-bottom area near the OpenClaw status button.
3. Keep the OpenClaw status button visible and separate.
4. Route `activeNav === "settings"` to the settings page.
5. Use icon-first button styling consistent with existing nav controls.
6. Run: `pnpm build`.

### Task 5: Build Settings Page UI

**Files:**

- Create: `src/components/SettingsPage.tsx`
- Modify: `src/App.css`

**Steps:**

1. Build a two-column settings layout:
   - left section list
   - right selected settings form
2. Add General, Appearance, Notifications, OpenClaw, and Advanced sections.
3. Use segmented controls for enum choices, toggles for booleans, and compact rows for read-only OpenClaw status.
4. Avoid nested cards; use full-width sections and simple setting rows.
5. Disable OpenClaw actions while their current command is busy.
6. Run: `pnpm build`.

### Task 6: Wire Default Conversation Mode

**Files:**

- Modify: `src/components/ConversationWorkspace.tsx`
- Modify: `src/App.tsx`

**Steps:**

1. Accept `defaultDisplayMode` as a prop.
2. Initialize `detailDisplayMode` from settings.
3. When the user toggles mode inside a conversation, decide whether it is per-session temporary or saved globally.
4. For the first version, keep the settings page as the source for the global default and leave the inline toggle temporary.
5. Add a focused manual regression:
   - set default to `conversation`
   - open another conversation
   - verify it opens in conversation mode
6. Run: `pnpm build`.

### Task 7: Apply Appearance Settings

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/App.css`

**Steps:**

1. Add root data attributes:
   - `data-theme`
   - `--app-font-size`
   - `data-density`
   - `data-message-width`
   - `data-code-wrap`
2. Implement CSS variables for font scale and density.
3. Resolve `theme: system` in runtime state to the current system light/dark appearance, then render the actual `data-theme`.
4. Keep default visual output close to the current dark theme.
5. Verify text does not overflow compact controls.
6. Run: `pnpm build`.

### Task 8: Add Notification Plugin

**Files:**

- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/src/lib.rs`
- Create: `src/lib/notifications.ts`

**Steps:**

1. Add `@tauri-apps/plugin-notification`.
2. Add `tauri-plugin-notification`.
3. Register the plugin in Tauri builder.
4. Add required notification permissions to the default capability.
5. Add a frontend helper:
   - request permission when needed
   - check permission
   - send notification with title/body
6. Keep notification errors non-fatal.
7. Run:
   - `pnpm install`
   - `pnpm build`
   - `cargo check --manifest-path src-tauri/Cargo.toml`

### Task 9: Notify on Conversation Completion

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/lib/notifications.ts`
- Test: `src/lib/notifications.test.ts` or focused tests around run transition helpers.

**Steps:**

1. Extract a pure helper that detects terminal transitions from conversation runtime state.
2. Track notified run ids or terminal timestamps in a ref.
3. Ignore startup/historical reconciliation.
4. Respect notification settings:
   - enabled
   - success/failure filters
   - only when unfocused
   - privacy mode
5. Notify with a short summary.
6. If notification click handling is available, focus main window and select the conversation.
7. Add tests for no duplicate notifications, startup suppression, success/failure filtering, and privacy body.
8. Run: `pnpm test` and `pnpm build`.

### Task 10: Implement Language Layer for New UI

**Files:**

- Create: `src/lib/i18n.ts`
- Create: `src/locales/zh-CN.ts`
- Create: `src/locales/en-US.ts`
- Modify: `src/components/AppChrome.tsx`
- Modify: `src/components/SettingsPage.tsx`
- Modify: `src/lib/notifications.ts`

**Steps:**

1. Add locale dictionaries for new settings and notification strings.
2. Add `resolveLocale(setting, systemLanguage)`.
3. Pass `t` or a lightweight locale object from App into settings/nav surfaces.
4. Keep existing large pages unchanged for the first iteration.
5. Run: `pnpm build`.

### Task 11: OpenClaw Settings Actions

**Files:**

- Modify: `src/components/SettingsPage.tsx`
- Modify: `src/App.tsx`
- Reuse existing commands in `src-tauri/src/lib.rs`.

**Steps:**

1. Display existing OpenClaw install/version/update state.
2. Display Gateway connection status from current app state.
3. Add buttons for:
   - reconnect Gateway
   - start Gateway
   - stop Gateway
   - repair client binding
   - open install/update terminal flows
4. Do not add raw config editors.
5. Keep model/provider/channel management linked to their existing pages.
6. Run: `pnpm build`.

### Task 12: Full Verification

**Files:**

- No new files.

**Steps:**

1. Run: `pnpm test`.
2. Run: `pnpm build`.
3. Run: `cargo check --manifest-path src-tauri/Cargo.toml`.
4. Manual regression:
   - launch app with no `~/.clawkit/clawkit.json`
   - verify settings file is created/merged
   - change language/theme/font size
   - change default conversation mode
   - send a conversation and verify completion notification
   - verify no notification on startup-loaded completed sessions
   - verify Gateway unavailable state still renders settings page shell
   - verify macOS notification permission flow
5. Windows follow-up:
   - verify notification plugin behavior
   - verify settings file path under the Windows user home
   - verify Gateway start/stop actions remain platform-safe.

## Open Questions

- Should default conversation display mode changes immediately affect the currently open conversation, or only new conversation openings?
- Should notifications fire while the pet floating window is visible, or should pet feedback count as enough?
- Should language eventually cover all existing pages in one migration, or remain incremental?
- Should OpenClaw settings expose Gateway auto-start now, or wait until start/stop behavior is more stable on Windows?

## Suggested Implementation Order

1. Settings data model and Tauri persistence.
2. Settings navigation and page shell.
3. General settings and default conversation mode.
4. Appearance settings.
5. Notification plugin and completion detection.
6. Language layer for new UI.
7. OpenClaw settings actions.
8. Advanced diagnostics.
