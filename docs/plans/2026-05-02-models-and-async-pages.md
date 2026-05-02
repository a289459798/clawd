# Models and Async Pages Notes

> Last updated: 2026-05-02

This note records the current model-management and slow-page conventions so future AI/developers can continue the feature without re-discovering the same OpenClaw boundaries.

## Goals

- Make OpenClaw model configuration approachable for normal users.
- Keep clawx aligned with OpenClaw Gateway/config semantics.
- Avoid blocking the desktop UI while Gateway, OpenClaw CLI, npm, or catalog loading is slow.
- Preserve macOS and Windows compatibility for terminal, auth, install, and update flows.

## Current Model Page Shape

- Navigation has a dedicated `models` page below conversations.
- The page uses a left/right structure:
  - Left: provider list, search, filters, add custom provider.
  - Right: selected provider details and models.
- Provider config is separate from model config.
- Provider config includes connection fields such as API Key and Base URL.
- Model config includes model name, alias, and default flag.
- If a provider is not configured, its model rows are disabled and show “请先配置 Provider”.
- Configured provider rows expose “配置” and “增加”.
- Configured model rows expose “修改” and “设为默认”; the default row shows “当前默认”.
- Modal close buttons use icon-only close controls, not text labels.
- Both panes scroll independently.

## Gateway and Config Sources

Use Gateway/OpenClaw in this order:

1. `models.list` for configured models.
2. `models.list` all/catalog view for supported provider/model catalog.
3. `models.authStatus` for OAuth status.
4. `config.get` + `baseHash` + `config.patch` for writes.

Do not treat clawx UI state as the source of truth for default models or provider config. After a write, update the UI optimistically only as a short-lived interaction state, then reconcile from Gateway/config in the background.

## Config Write Rules

Default model:

- Patch `agents.defaults.model.primary`.
- Ensure the selected model is present in the configured/default allowlist expected by OpenClaw.
- Do not append unsupported fields to `chat.send`.

Provider config:

- Patch under the matching `models.providers.<providerId>` shape expected by OpenClaw.
- Avoid showing saved API keys back to the user.
- Prefer OpenClaw SecretRef/schema support when it becomes available.

Model add/edit:

- Update the selected provider's model list.
- Keep provider connection fields out of the model form.
- Support aliases for user-friendly display, but preserve the canonical model id/name.

OAuth:

- Use visible external flows such as `openclaw models auth login --provider <providerId>`.
- Do not embed provider OAuth pages into a hidden or opaque WebView.
- Keep platform differences in Tauri/Rust, not in React.

## Async Page Rules

The following operations may block for seconds and must not run on the UI thread or block page navigation:

- `models.list` all/catalog view
- `models.authStatus`
- `skills.status`
- `skills.update`
- `channels.status`
- `sessions.usage`
- `config.get`
- `config.patch`
- OpenClaw CLI version/update/auth commands
- npm/plugin install/update commands

Frontend behavior:

- Open the page shell immediately.
- Load data after first paint.
- Show content-area, row, card, or button loading states.
- Keep controls interactive where possible.
- Optimistically update simple successful states, then refresh in the background.
- Display inline errors near the action that failed.

Tauri/Rust behavior:

- Commands that call blocking Gateway waits, OpenClaw CLI, npm, or file-heavy work should be `async`.
- Put blocking work inside `tauri::async_runtime::spawn_blocking`.
- Return user-readable errors; do not collapse failures into generic “unknown error”.

## Known Follow-Ups

- Add tests for model config payload builders and default-model selection.
- Add schema-driven provider forms when Gateway/OpenClaw exposes enough schema metadata.
- Add SecretRef support for API keys.
- Add per-agent default model editing.
- Add fallback-chain editing when OpenClaw exposes the canonical schema.
- Add provider documentation links in the UI.
- Add Windows real-machine regression for OAuth terminal flows and `openclaw update`.
