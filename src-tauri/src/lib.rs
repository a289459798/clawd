mod gateway_proxy;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::process::{Output, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::utils::config::Color;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

#[derive(Serialize, Clone)]
struct AgentSummary {
    id: String,
    name: String,
    workspace: Option<String>,
    model: Option<String>,
    agent_dir: Option<String>,
}

#[derive(Serialize, Clone)]
struct SessionSummary {
    id: String,
    agent_id: String,
    key: String,
    title: String,
    label: Option<String>,
    updated_at: Option<i64>,
    channel: Option<String>,
    session_file: Option<String>,
    last_message: Option<String>,
    last_role: Option<String>,
    latest_event_role: Option<String>,
    latest_event_type: Option<String>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_read_tokens: Option<u64>,
    cache_write_tokens: Option<u64>,
    total_tokens: Option<u64>,
    total_tokens_fresh: Option<bool>,
    estimated_cost_usd: Option<f64>,
    preview_messages: Vec<SessionMessage>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SessionMessage {
    role: Option<String>,
    text: String,
    parts: Vec<SessionMessagePart>,
    model: Option<String>,
    provider: Option<String>,
    api: Option<String>,
    timestamp: Option<i64>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_read_tokens: Option<u64>,
    cache_write_tokens: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum SessionMessagePart {
    Text {
        text: String,
    },
    ToolCall {
        tool: String,
        args: Option<String>,
    },
    ToolResult {
        tool: Option<String>,
        text: Option<String>,
    },
    Image {
        mime_type: Option<String>,
        data: String,
        alt: Option<String>,
    },
}

#[derive(Serialize)]
struct ConnectionSummary {
    id: String,
    name: String,
    enabled: bool,
}

#[derive(Serialize)]
struct SkillSummary {
    id: String,
    name: String,
    location: String,
}

#[derive(Serialize)]
struct OpenClawSnapshot {
    agents: Vec<AgentSummary>,
    sessions: Vec<SessionSummary>,
    connections: Vec<ConnectionSummary>,
    skills: Vec<SkillSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionRecordResult {
    session_file: String,
    messages: Vec<SessionMessage>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayAuthInfo {
    url: String,
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClawxBootstrapStatus {
    openclaw_installed: bool,
    openclaw_path: Option<String>,
    config_exists: bool,
    config_path: String,
    binding_configured: bool,
    allowed_origins: Vec<String>,
    recommended_origin: String,
    gateway_port: Option<u64>,
    binding_writes: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WeixinPluginStatus {
    installed: bool,
    enabled: bool,
    installed_version: Option<String>,
    latest_version: Option<String>,
    update_available: bool,
    latest_check_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenClawCliStatus {
    installed: bool,
    path: Option<String>,
    installed_version: Option<String>,
    latest_version: Option<String>,
    update_available: bool,
    latest_check_error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PetSummary {
    id: String,
    name: String,
    species: String,
    description: String,
    status: String,
    source: String,
    path: Option<String>,
    icon: Option<String>,
    image: Option<String>,
    spritesheet: Option<String>,
    spritesheet_data_url: Option<String>,
    atlas: Option<PetAtlas>,
    animations: Option<HashMap<String, PetAnimation>>,
    compatible_with: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PetAtlas {
    columns: u32,
    rows: u32,
    cell_width: u32,
    cell_height: u32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PetAnimation {
    row: u32,
    frames: u32,
    frame_ms: Vec<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PetManifestDraft {
    id: Option<String>,
    #[serde(alias = "displayName")]
    name: Option<String>,
    species: Option<String>,
    description: Option<String>,
    status: Option<String>,
    icon: Option<String>,
    image: Option<String>,
    spritesheet_path: Option<String>,
    spritesheet: Option<String>,
    atlas: Option<PetAtlas>,
    #[serde(default, alias = "states")]
    animations: HashMap<String, PetAnimation>,
    #[serde(default)]
    compatible_with: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RealtimeSessionPatch {
    key: String,
    updated_at: Option<i64>,
    last_message: Option<String>,
    last_role: Option<String>,
    latest_event_role: Option<String>,
    latest_event_type: Option<String>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_read_tokens: Option<u64>,
    cache_write_tokens: Option<u64>,
    total_tokens: Option<u64>,
    model: Option<String>,
    status: Option<String>,
    preview_messages: Option<Vec<SessionMessage>>,
}

#[derive(Serialize, Clone)]
struct RealtimeGatewayEvent {
    #[serde(rename = "type")]
    event_type: String,
    session: RealtimeSessionPatch,
}

#[derive(Default)]
struct RealtimeState {
    next_subscription_id: AtomicU64,
    subscribers: Mutex<HashMap<u64, String>>,
    watcher_started: AtomicBool,
    last_session_signatures: Mutex<HashMap<String, String>>,
}

fn openclaw_config_path() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".openclaw").join("openclaw.json"))
}

fn codex_pets_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".codex").join("pets"))
}

fn clawkit_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".clawkit"))
}

fn clawkit_pets_dir() -> Result<PathBuf, String> {
    Ok(clawkit_dir()?.join("pets"))
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .map_err(|error| format!("home directory not found: {error}"))
}

fn ensure_clawkit_home() -> Result<(), String> {
    let root = clawkit_dir()?;
    fs::create_dir_all(root.join("pets"))
        .map_err(|error| format!("failed to create {}: {error}", root.join("pets").display()))?;
    fs::create_dir_all(root.join("skills")).map_err(|error| {
        format!(
            "failed to create {}: {error}",
            root.join("skills").display()
        )
    })?;
    let config_path = root.join("clawkit.json");
    if !config_path.exists() {
        fs::write(&config_path, "{\n  \"version\": 1\n}\n")
            .map_err(|error| format!("failed to create {}: {error}", config_path.display()))?;
    }
    Ok(())
}

fn clawx_recommended_origin() -> String {
    "tauri://localhost".to_string()
}

fn sessions_store_path(agent_id: &str) -> Result<PathBuf, String> {
    Ok(home_dir()?
        .join(".openclaw")
        .join("agents")
        .join(agent_id)
        .join("sessions")
        .join("sessions.json"))
}

fn local_prefix_openclaw_path() -> Option<PathBuf> {
    let home = home_dir().ok()?;
    let bin_dir = home.join(".openclaw").join("bin");
    let candidates = if cfg!(windows) {
        vec![
            bin_dir.join("openclaw.cmd"),
            bin_dir.join("openclaw.exe"),
            bin_dir.join("openclaw"),
        ]
    } else {
        vec![bin_dir.join("openclaw")]
    };
    candidates.into_iter().find(|path| path.is_file())
}

fn openclaw_candidate_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = local_prefix_openclaw_path() {
        candidates.push(path);
    }

    if let Ok(home) = home_dir() {
        if cfg!(windows) {
            candidates.extend([
                home.join("AppData")
                    .join("Roaming")
                    .join("npm")
                    .join("openclaw.cmd"),
                home.join("scoop").join("shims").join("openclaw.cmd"),
            ]);
        } else {
            candidates.extend([
                home.join(".local").join("bin").join("openclaw"),
                home.join(".npm-global").join("bin").join("openclaw"),
                home.join("Library").join("pnpm").join("openclaw"),
                home.join(".pnpm").join("openclaw"),
            ]);

            let nvm_versions = home.join(".nvm").join("versions").join("node");
            if let Ok(entries) = fs::read_dir(nvm_versions) {
                for entry in entries.flatten() {
                    candidates.push(entry.path().join("bin").join("openclaw"));
                }
            }
        }
    }

    if !cfg!(windows) {
        candidates.extend([
            PathBuf::from("/opt/homebrew/bin/openclaw"),
            PathBuf::from("/usr/local/bin/openclaw"),
            PathBuf::from("/usr/bin/openclaw"),
        ]);
    }

    let mut seen = std::collections::HashSet::new();
    candidates
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

fn enhanced_path_env(extra_command_path: Option<&Path>) -> Option<std::ffi::OsString> {
    let mut paths: Vec<PathBuf> = Vec::new();
    if let Some(command_path) = extra_command_path.and_then(Path::parent) {
        paths.push(command_path.to_path_buf());
    }
    paths.extend(
        openclaw_candidate_paths()
            .into_iter()
            .filter_map(|path| path.parent().map(Path::to_path_buf)),
    );
    if !cfg!(windows) {
        paths.extend([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
            PathBuf::from("/usr/sbin"),
            PathBuf::from("/sbin"),
        ]);
    }
    if let Some(existing) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&existing));
    }

    let mut seen = std::collections::HashSet::new();
    std::env::join_paths(paths.into_iter().filter(|path| seen.insert(path.clone()))).ok()
}

fn resolve_openclaw_command() -> Option<PathBuf> {
    if let Some(path) = openclaw_candidate_paths()
        .into_iter()
        .find(|path| path.is_file())
    {
        return Some(path);
    }

    if cfg!(windows) {
        let path_output = Command::new("cmd")
            .args(["/C", "where", "openclaw"])
            .env("PATH", enhanced_path_env(None)?)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .ok()
            .filter(|output| output.status.success())
            .and_then(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .map(str::trim)
                    .find(|line| !line.is_empty())
                    .map(PathBuf::from)
            });

        return path_output;
    }

    let path_output = Command::new("sh")
        .arg("-lc")
        .arg("command -v openclaw")
        .env("PATH", enhanced_path_env(None)?)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if path.is_empty() {
                None
            } else {
                Some(PathBuf::from(path))
            }
        });

    path_output
}

fn run_openclaw_command(args: &[&str]) -> Result<Output, String> {
    let command_path = resolve_openclaw_command().ok_or_else(|| {
        "OpenClaw command not found. Expected openclaw in PATH, ~/.openclaw/bin/openclaw, or %USERPROFILE%\\.openclaw\\bin\\openclaw.cmd".to_string()
    })?;
    let mut command = Command::new(&command_path);
    if let Some(path_env) = enhanced_path_env(Some(&command_path)) {
        command.env("PATH", path_env);
    }
    command.args(args).output().map_err(|error| {
        format!(
            "failed to run {} {}: {error}",
            command_path.display(),
            args.join(" ")
        )
    })
}

fn openclaw_command(path: &Path) -> Command {
    let mut command = Command::new(path);
    if let Some(path_env) = enhanced_path_env(Some(path)) {
        command.env("PATH", path_env);
    }
    command
}

fn session_title_from_key(key: &str) -> String {
    key.split(':').skip(2).collect::<Vec<_>>().join(" · ")
}

fn truncate_text(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    let mut chars = trimmed.chars();
    let collected = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{}…", collected)
    } else {
        collected
    }
}

fn strip_metadata_blocks(text: &str) -> String {
    let mut result = text.to_string();
    for marker in [
        "Conversation info (untrusted metadata):",
        "Sender (untrusted metadata):",
        "Chat history since last reply (untrusted, for context):",
    ] {
        while let Some(start) = result.find(marker) {
            let tail = &result[start..];
            if let Some(end_rel) = tail.find("```\n\n") {
                let end = start + end_rel + 4;
                result.replace_range(start..end, "");
            } else {
                break;
            }
        }
    }
    result.replace("MEDIA:", "").trim().to_string()
}

fn summarize_for_list(text: &str) -> String {
    let cleaned = strip_metadata_blocks(text);
    let mut lines = cleaned
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && !line.starts_with("```")
                && !line.starts_with('{')
                && !line.starts_with('[')
        })
        .collect::<Vec<_>>();

    if lines.is_empty() {
        return "暂无有效内容".to_string();
    }

    if lines[0].starts_with("tool_result:") || lines[0].starts_with("tool_call:") {
        lines.remove(0);
    }

    let summary = lines.join(" ");
    truncate_text(&summary, 120)
}

fn extract_message_parts(value: &Value) -> Vec<SessionMessagePart> {
    let message = value
        .get("message")
        .or_else(|| {
            value
                .get("type")
                .and_then(Value::as_str)
                .filter(|t| t == &"message")
                .map(|_| value)
        })
        .unwrap_or(value);
    let Some(content) = message.get("content").or_else(|| value.get("content")) else {
        return Vec::new();
    };

    let is_tool_result = message
        .get("role")
        .and_then(Value::as_str)
        .map(|r| r == "toolResult")
        .unwrap_or(false);
    let tool_name = message
        .get("toolName")
        .and_then(Value::as_str)
        .map(str::to_string);

    let mut parts = Vec::new();

    if let Some(text) = content.as_str() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            if is_tool_result {
                parts.push(SessionMessagePart::ToolResult {
                    tool: tool_name,
                    text: Some(trimmed.to_string()),
                });
            } else {
                parts.push(SessionMessagePart::Text {
                    text: trimmed.to_string(),
                });
            }
        }
        return parts;
    }

    if let Some(items) = content.as_array() {
        for item in items {
            let Some(kind) = item.get("type").and_then(Value::as_str) else {
                continue;
            };
            match kind {
                "text" => {
                    if let Some(text) = item
                        .get("text")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|text| !text.is_empty())
                    {
                        if is_tool_result {
                            parts.push(SessionMessagePart::ToolResult {
                                tool: tool_name.clone(),
                                text: Some(text.to_string()),
                            });
                        } else {
                            parts.push(SessionMessagePart::Text {
                                text: text.to_string(),
                            });
                        }
                    }
                }
                "toolCall" => {
                    if let Some(name) = item.get("name").and_then(Value::as_str) {
                        let args = item
                            .get("arguments")
                            .map(|v| serde_json::to_string_pretty(v).unwrap_or_default())
                            .filter(|value| !value.is_empty());
                        parts.push(SessionMessagePart::ToolCall {
                            tool: name.to_string(),
                            args,
                        });
                    }
                }
                "image" | "input_image" | "image_url" => {
                    let data = item
                        .get("data")
                        .or_else(|| item.get("url"))
                        .or_else(|| item.get("image_url").and_then(|value| value.get("url")))
                        .and_then(Value::as_str)
                        .map(str::to_string);
                    if let Some(data) = data {
                        parts.push(SessionMessagePart::Image {
                            mime_type: item
                                .get("mimeType")
                                .or_else(|| item.get("mime_type"))
                                .and_then(Value::as_str)
                                .map(str::to_string),
                            data,
                            alt: item
                                .get("text")
                                .or_else(|| item.get("alt"))
                                .and_then(Value::as_str)
                                .map(str::to_string),
                        });
                    }
                }
                _ => {}
            }
        }
    }

    parts
}

fn extract_message_text(value: &Value) -> Option<String> {
    let parts = extract_message_parts(value);
    let mut lines = Vec::new();

    for part in parts {
        match part {
            SessionMessagePart::Text { text } => lines.push(text),
            SessionMessagePart::ToolCall { tool, .. } => lines.push(format!("tool_call: {tool}")),
            SessionMessagePart::ToolResult { tool, text } => {
                if let Some(text) = text.filter(|value| !value.is_empty()) {
                    lines.push(match tool {
                        Some(tool) => format!("tool_result: {tool} {text}"),
                        None => text,
                    });
                } else if let Some(tool) = tool {
                    lines.push(format!("tool_result: {tool}"));
                }
            }
            SessionMessagePart::Image { .. } => lines.push("[图片]".to_string()),
        }
    }

    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

fn read_usage_fields(
    value: &Value,
) -> (
    Option<u64>,
    Option<u64>,
    Option<u64>,
    Option<u64>,
    Option<u64>,
) {
    let usage = value
        .get("message")
        .and_then(|message| message.get("usage"))
        .or_else(|| value.get("usage"));

    let Some(usage) = usage else {
        return (None, None, None, None, None);
    };

    (
        usage.get("input").and_then(Value::as_u64),
        usage.get("output").and_then(Value::as_u64),
        usage.get("cacheRead").and_then(Value::as_u64),
        usage.get("cacheWrite").and_then(Value::as_u64),
        usage.get("totalTokens").and_then(Value::as_u64),
    )
}

/// Extract per-message usage from JSONL values.
/// Input tokens are cumulative (context grows each turn), so we compute deltas.
/// Output tokens are already per-message, so we use raw values.
/// Cache tokens may be cumulative, so we compute deltas for them too.
fn compute_per_message_usage(
    messages: &[(
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<i64>,
        Vec<SessionMessagePart>,
        String,
    )],
    cumulative_inputs: &[Option<u64>],
    cumulative_outputs: &[Option<u64>],
    cumulative_cache_read: &[Option<u64>],
    cumulative_cache_write: &[Option<u64>],
) -> Vec<(Option<u64>, Option<u64>, Option<u64>, Option<u64>)> {
    let n = messages.len();
    let mut results = Vec::with_capacity(n);

    for i in 0..n {
        let role = &messages[i].0;
        let is_assistant = role
            .as_deref()
            .map(|r| r.to_lowercase() == "assistant")
            .unwrap_or(false);

        if !is_assistant {
            // Non-assistant messages have no usage
            results.push((None, None, None, None));
            continue;
        }

        // Find the previous assistant cumulative values (for delta calculation)
        let mut prev_input = None;
        let mut prev_cache_read = None;
        let mut prev_cache_write = None;

        for j in (0..i).rev() {
            let j_role = &messages[j].0;
            if j_role
                .as_deref()
                .map(|r| r.to_lowercase() == "assistant")
                .unwrap_or(false)
            {
                prev_input = cumulative_inputs[j];
                prev_cache_read = cumulative_cache_read[j];
                prev_cache_write = cumulative_cache_write[j];
                break;
            }
        }

        let cur_input = cumulative_inputs[i];
        // Output is already per-message, use raw value
        let cur_output = cumulative_outputs[i];
        let cur_cache_read = cumulative_cache_read[i];
        let cur_cache_write = cumulative_cache_write[i];

        // Input delta: new tokens consumed this turn (current - prev cumulative)
        let delta_input = match (cur_input, prev_input) {
            (Some(cur), Some(prev)) => Some(cur.saturating_sub(prev)),
            (Some(cur), None) => Some(cur),
            _ => None,
        };
        // Output: already per-message, use as-is
        let output = cur_output;
        // Cache deltas: may be cumulative, compute delta
        let delta_cache_read = match (cur_cache_read, prev_cache_read) {
            (Some(cur), Some(prev)) => Some(cur.saturating_sub(prev)),
            (Some(cur), None) => Some(cur),
            _ => None,
        };
        let delta_cache_write = match (cur_cache_write, prev_cache_write) {
            (Some(cur), Some(prev)) => Some(cur.saturating_sub(prev)),
            (Some(cur), None) => Some(cur),
            _ => None,
        };

        results.push((delta_input, output, delta_cache_read, delta_cache_write));
    }

    results
}

fn read_session_preview(
    session_file: &str,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<u64>,
    Option<u64>,
    Option<u64>,
    Option<u64>,
    Option<u64>,
    Vec<SessionMessage>,
) {
    let Ok(content) = fs::read_to_string(session_file) else {
        return (
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Vec::new(),
        );
    };

    // First pass: collect all messages with their cumulative usage
    type RawMessage = (
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<i64>,
        Vec<SessionMessagePart>,
        String,
    );
    let mut raw_messages: Vec<RawMessage> = Vec::new();
    let mut cumulative_inputs: Vec<Option<u64>> = Vec::new();
    let mut cumulative_outputs: Vec<Option<u64>> = Vec::new();
    let mut cumulative_cache_read: Vec<Option<u64>> = Vec::new();
    let mut cumulative_cache_write: Vec<Option<u64>> = Vec::new();

    let mut last_message = None;
    let mut last_role = None;
    let mut session_input = 0_u64;
    let mut session_output = 0_u64;
    let mut session_cache_read = 0_u64;
    let mut session_cache_write = 0_u64;
    let mut session_total = 0_u64;
    let mut has_token_usage = false;
    let mut latest_event_role = None;
    let mut latest_event_type = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };

        latest_event_type = value
            .get("type")
            .and_then(Value::as_str)
            .map(str::to_string);
        latest_event_role = value
            .get("message")
            .and_then(|message| message.get("role"))
            .or_else(|| value.get("role"))
            .and_then(Value::as_str)
            .map(str::to_string);

        let (input, output, cache_read, cache_write, total) = read_usage_fields(&value);
        if let Some(tokens) = input {
            session_input = tokens;
            has_token_usage = true;
        }
        if let Some(tokens) = output {
            session_output = tokens;
            has_token_usage = true;
        }
        if let Some(tokens) = cache_read {
            session_cache_read = tokens;
            has_token_usage = true;
        }
        if let Some(tokens) = cache_write {
            session_cache_write = tokens;
            has_token_usage = true;
        }
        if let Some(tokens) = total {
            session_total = tokens;
            has_token_usage = true;
        }

        let message_obj = value.get("message").unwrap_or(&value);
        let role = message_obj
            .get("role")
            .or_else(|| value.get("role"))
            .and_then(Value::as_str)
            .map(str::to_string);
        let parts = extract_message_parts(&value);
        let Some(text) = extract_message_text(&value) else {
            continue;
        };
        let normalized = truncate_text(&text, 280);
        let model = message_obj
            .get("model")
            .and_then(Value::as_str)
            .map(str::to_string);
        let provider = message_obj
            .get("provider")
            .and_then(Value::as_str)
            .map(str::to_string);
        let api = message_obj
            .get("api")
            .and_then(Value::as_str)
            .map(str::to_string);
        let message_timestamp = message_obj
            .get("timestamp")
            .and_then(Value::as_i64)
            .or_else(|| value.get("timestamp").and_then(Value::as_i64));

        // Store cumulative values for this message
        cumulative_inputs.push(input);
        cumulative_outputs.push(output);
        cumulative_cache_read.push(cache_read);
        cumulative_cache_write.push(cache_write);

        last_message = Some(summarize_for_list(&text));
        last_role = role.clone();
        raw_messages.push((
            role,
            model,
            provider,
            api,
            message_timestamp,
            parts,
            normalized,
        ));
    }

    // Second pass: compute per-message deltas from cumulative values
    let deltas = compute_per_message_usage(
        &raw_messages,
        &cumulative_inputs,
        &cumulative_outputs,
        &cumulative_cache_read,
        &cumulative_cache_write,
    );

    // Build final messages with delta usage
    let mut preview_messages: Vec<SessionMessage> = Vec::with_capacity(raw_messages.len());
    for (i, (role, model, provider, api, timestamp, parts, text)) in
        raw_messages.into_iter().enumerate()
    {
        let (input_delta, output_delta, cache_read_delta, cache_write_delta) = deltas[i];
        preview_messages.push(SessionMessage {
            role,
            text,
            parts,
            model,
            provider,
            api,
            timestamp,
            input_tokens: input_delta,
            output_tokens: output_delta,
            cache_read_tokens: cache_read_delta,
            cache_write_tokens: cache_write_delta,
        });
    }

    let last_user_index = preview_messages
        .iter()
        .rposition(|message| message.role.as_deref() == Some("user"));
    let preview_messages = if let Some(index) = last_user_index {
        preview_messages
            .into_iter()
            .skip(index)
            .take(24)
            .collect::<Vec<_>>()
    } else {
        let start = preview_messages.len().saturating_sub(24);
        preview_messages.into_iter().skip(start).collect::<Vec<_>>()
    };
    (
        last_message,
        last_role,
        latest_event_role,
        latest_event_type,
        if has_token_usage {
            Some(session_input)
        } else {
            None
        },
        if has_token_usage {
            Some(session_output)
        } else {
            None
        },
        if has_token_usage {
            Some(session_cache_read)
        } else {
            None
        },
        if has_token_usage {
            Some(session_cache_write)
        } else {
            None
        },
        if has_token_usage {
            Some(session_total)
        } else {
            None
        },
        preview_messages,
    )
}

fn read_sessions_for_agent(agent_id: &str) -> Vec<SessionSummary> {
    let Ok(path) = sessions_store_path(agent_id) else {
        return Vec::new();
    };
    let Ok(content) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    let Ok(json) = serde_json::from_str::<Value>(&content) else {
        return Vec::new();
    };
    let Some(object) = json.as_object() else {
        return Vec::new();
    };

    let mut sessions = object
        .iter()
        .map(|(key, entry)| {
            let session_file = entry
                .get("sessionFile")
                .and_then(Value::as_str)
                .map(str::to_string);
            let (
                last_message,
                last_role,
                latest_event_role,
                latest_event_type,
                input_tokens,
                output_tokens,
                cache_read_tokens,
                cache_write_tokens,
                total_tokens,
                preview_messages,
            ) = session_file
                .as_deref()
                .map(read_session_preview)
                .unwrap_or((
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    Vec::new(),
                ));

            SessionSummary {
                id: entry
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .unwrap_or(key)
                    .to_string(),
                agent_id: agent_id.to_string(),
                key: key.clone(),
                title: entry
                    .get("label")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| session_title_from_key(key)),
                label: entry
                    .get("label")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                updated_at: entry.get("updatedAt").and_then(Value::as_i64),
                channel: entry
                    .get("lastChannel")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                session_file,
                last_message,
                last_role,
                latest_event_role,
                latest_event_type,
                input_tokens: entry
                    .get("inputTokens")
                    .and_then(Value::as_u64)
                    .or(input_tokens),
                output_tokens: entry
                    .get("outputTokens")
                    .and_then(Value::as_u64)
                    .or(output_tokens),
                cache_read_tokens,
                cache_write_tokens,
                total_tokens: entry
                    .get("totalTokens")
                    .and_then(Value::as_u64)
                    .or(total_tokens),
                total_tokens_fresh: entry.get("totalTokensFresh").and_then(Value::as_bool),
                estimated_cost_usd: entry.get("estimatedCostUsd").and_then(Value::as_f64),
                preview_messages,
            }
        })
        .collect::<Vec<_>>();

    sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    sessions
}

fn read_skills_from_dir(root: &PathBuf) -> Vec<SkillSummary> {
    let mut skills = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            let skill_md = path.join("SKILL.md");
            if skill_md.exists() {
                let name = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("unknown-skill")
                    .to_string();
                skills.push(SkillSummary {
                    id: name.clone(),
                    name,
                    location: skill_md.display().to_string(),
                });
            }
        }
    }
    skills
}

fn emit_realtime_event(app: &AppHandle, state: &RealtimeState, payload: &RealtimeGatewayEvent) {
    let subscribers = state.subscribers.lock().unwrap().clone();
    for (_, event_name) in subscribers {
        let _ = app.emit(&event_name, payload.clone());
    }
}

fn emit_snapshot_event(app: &AppHandle, state: &RealtimeState, session: &SessionSummary) {
    emit_realtime_event(
        app,
        state,
        &RealtimeGatewayEvent {
            event_type: "session_patch".to_string(),
            session: RealtimeSessionPatch {
                key: session.key.clone(),
                updated_at: session.updated_at,
                last_message: session.last_message.clone(),
                last_role: session.last_role.clone(),
                latest_event_role: session.latest_event_role.clone(),
                latest_event_type: session.latest_event_type.clone(),
                input_tokens: session.input_tokens,
                output_tokens: session.output_tokens,
                cache_read_tokens: session.cache_read_tokens,
                cache_write_tokens: session.cache_write_tokens,
                total_tokens: session.total_tokens,
                model: None,
                status: None,
                preview_messages: Some(session.preview_messages.clone()),
            },
        },
    );
}

fn session_signature(session: &SessionSummary) -> String {
    format!(
        "{}|{}|{}|{}|{}",
        session.updated_at.unwrap_or_default(),
        session.last_role.clone().unwrap_or_default(),
        session.last_message.clone().unwrap_or_default(),
        session.preview_messages.len(),
        session
            .preview_messages
            .last()
            .map(|message| message.text.clone())
            .unwrap_or_default()
    )
}

fn ensure_realtime_watcher(app: &AppHandle, state: Arc<RealtimeState>) {
    if state.watcher_started.swap(true, Ordering::SeqCst) {
        return;
    }

    let app = app.clone();
    thread::spawn(move || loop {
        if let Ok(snapshot) = load_openclaw_snapshot() {
            let mut signatures = state.last_session_signatures.lock().unwrap();
            for session in snapshot.sessions {
                let signature = session_signature(&session);
                let changed = signatures
                    .get(&session.key)
                    .map(|previous| previous != &signature)
                    .unwrap_or(true);
                if changed {
                    signatures.insert(session.key.clone(), signature);
                    emit_snapshot_event(&app, state.as_ref(), &session);
                }
            }
        }
        thread::sleep(Duration::from_millis(900));
    });
}

fn stream_latest_snapshot(app: &AppHandle, state: &RealtimeState) {
    if let Ok(snapshot) = load_openclaw_snapshot() {
        for session in &snapshot.sessions {
            emit_snapshot_event(app, state, session);
        }
    }
}

#[tauri::command]
fn subscribe_gateway_realtime(
    app: AppHandle,
    state: State<Arc<RealtimeState>>,
) -> Result<u64, String> {
    let subscription_id = state.next_subscription_id.fetch_add(1, Ordering::SeqCst) + 1;
    let event_name = format!("gateway-realtime://{subscription_id}");
    state
        .subscribers
        .lock()
        .map_err(|_| "failed to acquire realtime subscribers lock".to_string())?
        .insert(subscription_id, event_name);
    stream_latest_snapshot(&app, state.inner());
    ensure_realtime_watcher(&app, state.inner().clone());
    Ok(subscription_id)
}

#[tauri::command]
fn unsubscribe_gateway_realtime(
    subscription_id: u64,
    state: State<Arc<RealtimeState>>,
) -> Result<(), String> {
    state
        .subscribers
        .lock()
        .map_err(|_| "failed to acquire realtime subscribers lock".to_string())?
        .remove(&subscription_id);
    Ok(())
}

#[tauri::command]
fn resolve_dashboard_url() -> Result<String, String> {
    let output = run_openclaw_command(&["dashboard", "--no-open"])?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if let Some(url) = line.strip_prefix("Dashboard URL: ") {
                return Ok(url.trim().to_string());
            }
        }
    }

    let config_path = openclaw_config_path()?;
    let content = fs::read_to_string(&config_path)
        .map_err(|error| format!("failed to read {}: {error}", config_path.display()))?;
    let json: Value = serde_json::from_str(&content)
        .map_err(|error| format!("failed to parse {}: {error}", config_path.display()))?;
    let port = json
        .get("gateway")
        .and_then(|gateway| gateway.get("port"))
        .and_then(Value::as_u64)
        .unwrap_or(18789);
    Ok(format!("http://127.0.0.1:{port}"))
}

#[tauri::command]
fn load_openclaw_snapshot() -> Result<OpenClawSnapshot, String> {
    let config_path = openclaw_config_path()?;
    let content = fs::read_to_string(&config_path)
        .map_err(|error| format!("failed to read {}: {error}", config_path.display()))?;
    let json: Value = serde_json::from_str(&content)
        .map_err(|error| format!("failed to parse {}: {error}", config_path.display()))?;

    let agents = json
        .get("agents")
        .and_then(|agents| agents.get("list"))
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    let id = entry.get("id")?.as_str()?.to_string();
                    let name = entry
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or(&id)
                        .to_string();
                    Some(AgentSummary {
                        id,
                        name,
                        workspace: entry
                            .get("workspace")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        model: entry
                            .get("model")
                            .and_then(|model| model.get("primary"))
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        agent_dir: entry
                            .get("agentDir")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let sessions = agents
        .iter()
        .flat_map(|agent| read_sessions_for_agent(&agent.id))
        .collect::<Vec<_>>();

    let connections = json
        .get("channels")
        .and_then(Value::as_object)
        .map(|channels| {
            channels
                .iter()
                .map(|(id, entry)| ConnectionSummary {
                    id: id.clone(),
                    name: id.clone(),
                    enabled: entry
                        .get("enabled")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let user_root = home_dir()?.join(".agents").join("skills");

    let mut skills = read_skills_from_dir(&user_root);
    skills.sort_by(|left, right| left.name.cmp(&right.name));
    skills.dedup_by(|left, right| left.name == right.name);

    Ok(OpenClawSnapshot {
        agents,
        sessions,
        connections,
        skills,
    })
}

#[tauri::command]
fn load_session_record(session_key: String) -> Result<SessionRecordResult, String> {
    let config_path = openclaw_config_path()?;
    let content = fs::read_to_string(&config_path)
        .map_err(|error| format!("failed to read {}: {error}", config_path.display()))?;
    let json: Value = serde_json::from_str(&content)
        .map_err(|error| format!("failed to parse {}: {error}", config_path.display()))?;

    let agents = json
        .get("agents")
        .and_then(|agents| agents.get("list"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    for agent in agents {
        let Some(agent_id) = agent.get("id").and_then(Value::as_str) else {
            continue;
        };
        for session in read_sessions_for_agent(agent_id) {
            if session.key == session_key {
                let session_file = session
                    .session_file
                    .ok_or_else(|| format!("session_file missing for {session_key}"))?;
                let (_, _, _, _, _, _, _, _, _, messages) = read_session_preview(&session_file);
                return Ok(SessionRecordResult {
                    session_file,
                    messages,
                });
            }
        }
    }

    Err(format!("session not found: {session_key}"))
}

#[tauri::command]
fn get_clawx_bootstrap_status() -> Result<ClawxBootstrapStatus, String> {
    let config_path = openclaw_config_path()?;
    let openclaw_path = resolve_openclaw_command()
        .filter(|path| {
            openclaw_command(path)
                .arg("--version")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|status| status.success())
                .unwrap_or(false)
        })
        .map(|path| path.display().to_string());

    let config_exists = config_path.exists();
    let mut binding_configured = false;
    let mut allowed_origins = Vec::new();
    let mut gateway_port = None;

    if config_exists {
        let content = fs::read_to_string(&config_path)
            .map_err(|error| format!("failed to read {}: {error}", config_path.display()))?;
        let json: Value = serde_json::from_str(&content)
            .map_err(|error| format!("failed to parse {}: {error}", config_path.display()))?;
        allowed_origins = json
            .get("gateway")
            .and_then(|gateway| gateway.get("controlUi"))
            .and_then(|control_ui| control_ui.get("allowedOrigins"))
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let recommended_origin = clawx_recommended_origin();
        binding_configured = allowed_origins
            .iter()
            .any(|item| item == &recommended_origin);
        gateway_port = json
            .get("gateway")
            .and_then(|gateway| gateway.get("port"))
            .and_then(Value::as_u64);
    }

    let recommended_origin = clawx_recommended_origin();
    Ok(ClawxBootstrapStatus {
        openclaw_installed: openclaw_path.is_some(),
        openclaw_path,
        config_exists,
        config_path: config_path.display().to_string(),
        binding_configured,
        allowed_origins,
        recommended_origin: recommended_origin.clone(),
        gateway_port,
        binding_writes: vec![format!(
            "gateway.controlUi.allowedOrigins += {recommended_origin}"
        )],
    })
}

#[tauri::command]
fn ensure_clawx_binding() -> Result<ClawxBootstrapStatus, String> {
    let config_path = openclaw_config_path()?;
    let parent = config_path
        .parent()
        .ok_or_else(|| "invalid openclaw config path".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;

    let mut json: Value = if config_path.exists() {
        let content = fs::read_to_string(&config_path)
            .map_err(|error| format!("failed to read {}: {error}", config_path.display()))?;
        serde_json::from_str(&content)
            .map_err(|error| format!("failed to parse {}: {error}", config_path.display()))?
    } else {
        serde_json::json!({})
    };

    if !json.is_object() {
        json = serde_json::json!({});
    }

    let recommended_origin = clawx_recommended_origin();
    let root = json
        .as_object_mut()
        .ok_or_else(|| "invalid config root".to_string())?;
    let gateway = root
        .entry("gateway".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !gateway.is_object() {
        *gateway = serde_json::json!({});
    }
    let gateway_obj = gateway
        .as_object_mut()
        .ok_or_else(|| "invalid gateway config".to_string())?;
    let control_ui = gateway_obj
        .entry("controlUi".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !control_ui.is_object() {
        *control_ui = serde_json::json!({});
    }
    let control_ui_obj = control_ui
        .as_object_mut()
        .ok_or_else(|| "invalid controlUi config".to_string())?;
    let allowed = control_ui_obj
        .entry("allowedOrigins".to_string())
        .or_insert_with(|| serde_json::json!([]));
    if !allowed.is_array() {
        *allowed = serde_json::json!([]);
    }
    let allowed_arr = allowed
        .as_array_mut()
        .ok_or_else(|| "invalid allowedOrigins".to_string())?;
    let already = allowed_arr
        .iter()
        .any(|item| item.as_str() == Some(recommended_origin.as_str()));
    if !already {
        allowed_arr.push(Value::String(recommended_origin));
    }

    let pretty = serde_json::to_string_pretty(&json)
        .map_err(|error| format!("failed to serialize config: {error}"))?;
    fs::write(&config_path, format!("{pretty}\n"))
        .map_err(|error| format!("failed to write {}: {error}", config_path.display()))?;

    get_clawx_bootstrap_status()
}

#[tauri::command]
fn resolve_gateway_auth() -> Result<GatewayAuthInfo, String> {
    let config_path = openclaw_config_path()?;
    let content = fs::read_to_string(&config_path)
        .map_err(|error| format!("failed to read {}: {error}", config_path.display()))?;
    let json: Value = serde_json::from_str(&content)
        .map_err(|error| format!("failed to parse {}: {error}", config_path.display()))?;

    let gateway = json
        .get("gateway")
        .ok_or_else(|| "gateway config missing".to_string())?;
    let port = gateway.get("port").and_then(Value::as_u64).unwrap_or(18789);
    let token = gateway
        .get("auth")
        .and_then(|auth| auth.get("token"))
        .and_then(Value::as_str)
        .ok_or_else(|| "gateway auth token missing".to_string())?
        .to_string();

    Ok(GatewayAuthInfo {
        url: format!("ws://127.0.0.1:{port}/gateway"),
        token,
    })
}

#[tauri::command]
fn pick_workspace_directory() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .set_title("选择 Agent 工作区")
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn default_agent_workspace(agent_id: String) -> Result<String, String> {
    let agent_id = agent_id.trim();
    let safe_id = if agent_id.is_empty() {
        "agent"
    } else {
        agent_id
    };
    Ok(home_dir()?
        .join(".openclaw")
        .join(format!("workspace-{safe_id}"))
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
fn open_weixin_login_terminal() -> Result<String, String> {
    let login_command =
        openclaw_terminal_command(&["channels", "login", "--channel", "openclaw-weixin"])?;
    open_terminal_command(&login_command, "openclaw-weixin login")?;
    Ok("已打开终端，请在终端中扫描 openclaw-weixin 登录二维码。".to_string())
}

#[tauri::command]
fn open_model_auth_terminal(provider: String, set_default: Option<bool>) -> Result<String, String> {
    let provider = provider.trim().to_string();
    if provider.is_empty() {
        return Err("provider is required".to_string());
    }
    let mut args = vec!["models", "auth", "login", "--provider", provider.as_str()];
    if set_default.unwrap_or(false) {
        args.push("--set-default");
    }
    let auth_command = openclaw_terminal_command(&args)?;
    open_terminal_command(&auth_command, &format!("openclaw model auth {provider}"))?;
    Ok(format!(
        "已打开终端授权 {provider}。授权完成后请回到模型页刷新状态。"
    ))
}

fn applescript_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn powershell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn openclaw_terminal_env_prefix(command_path: &Path) -> String {
    let Some(path_env) = enhanced_path_env(Some(command_path)) else {
        return String::new();
    };
    let path_text = path_env.to_string_lossy();
    if cfg!(windows) {
        format!("$env:PATH = {}; ", powershell_quote(&path_text))
    } else {
        format!("export PATH={}; ", shell_quote(&path_text))
    }
}

fn openclaw_terminal_command(args: &[&str]) -> Result<String, String> {
    let command_path = resolve_openclaw_command().ok_or_else(|| {
        "OpenClaw command not found. Expected openclaw in PATH, ~/.openclaw/bin/openclaw, or %USERPROFILE%\\.openclaw\\bin\\openclaw.cmd".to_string()
    })?;
    let quote = if cfg!(windows) {
        powershell_quote
    } else {
        shell_quote
    };
    let mut parts = if cfg!(windows) {
        vec![format!(
            "{}& {}",
            openclaw_terminal_env_prefix(&command_path),
            quote(&command_path.to_string_lossy())
        )]
    } else {
        vec![format!(
            "{}{}",
            openclaw_terminal_env_prefix(&command_path),
            quote(&command_path.to_string_lossy())
        )]
    };
    parts.extend(args.iter().map(|arg| quote(arg)));
    Ok(parts.join(" "))
}

fn open_terminal_command_macos(command_line: &str, label: &str) -> Result<(), String> {
    let status = Command::new("osascript")
        .arg("-e")
        .arg(format!(
            "tell application \"Terminal\" to do script {}",
            applescript_quote(command_line)
        ))
        .arg("-e")
        .arg("tell application \"Terminal\" to activate")
        .status()
        .map_err(|error| format!("failed to open Terminal: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{label} terminal exited with status {status}"))
    }
}

fn open_terminal_command_windows(command_line: &str, label: &str) -> Result<(), String> {
    Command::new("powershell")
        .args([
            "-NoExit",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            command_line,
        ])
        .spawn()
        .map_err(|error| format!("failed to open PowerShell: {error}"))?;
    let _ = label;
    Ok(())
}

fn open_terminal_command_linux(command_line: &str, label: &str) -> Result<(), String> {
    let terminal_candidates: [(&str, &[&str]); 5] = [
        ("x-terminal-emulator", &["-e", "sh", "-lc"]),
        ("gnome-terminal", &["--", "sh", "-lc"]),
        ("konsole", &["-e", "sh", "-lc"]),
        ("xfce4-terminal", &["-e", "sh", "-lc"]),
        ("xterm", &["-e", "sh", "-lc"]),
    ];

    for (program, args) in terminal_candidates {
        let mut command = Command::new(program);
        command.args(args).arg(command_line);
        match command.status() {
            Ok(status) if status.success() => return Ok(()),
            Ok(_) => continue,
            Err(_) => continue,
        }
    }

    Err(format!("failed to open a terminal for {label}"))
}

fn open_terminal_command(command_line: &str, label: &str) -> Result<(), String> {
    match std::env::consts::OS {
        "macos" => open_terminal_command_macos(command_line, label),
        "windows" => open_terminal_command_windows(command_line, label),
        "linux" => open_terminal_command_linux(command_line, label),
        other => Err(format!(
            "unsupported platform for terminal command: {other}"
        )),
    }
}

fn npm_command_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    candidates.push(PathBuf::from(if cfg!(windows) { "npm.cmd" } else { "npm" }));
    for command_path in openclaw_candidate_paths() {
        if let Some(bin_dir) = command_path.parent() {
            candidates.push(bin_dir.join(if cfg!(windows) { "npm.cmd" } else { "npm" }));
        }
    }

    if let Ok(home) = home_dir() {
        if cfg!(windows) {
            candidates.extend([
                home.join("AppData")
                    .join("Roaming")
                    .join("npm")
                    .join("npm.cmd"),
                home.join("scoop").join("shims").join("npm.cmd"),
            ]);
        } else {
            candidates.extend([
                home.join("Library").join("pnpm").join("npm"),
                home.join(".npm-global").join("bin").join("npm"),
                home.join(".local").join("bin").join("npm"),
                PathBuf::from("/opt/homebrew/bin/npm"),
                PathBuf::from("/usr/local/bin/npm"),
            ]);
        }

        if let Ok(entries) = fs::read_dir(home.join(".openclaw").join("tools")) {
            for entry in entries.flatten() {
                let path = entry.path();
                let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                    continue;
                };
                if !name.starts_with("node-v") {
                    continue;
                }
                let npm_path = if cfg!(windows) {
                    path.join("npm.cmd")
                } else {
                    path.join("bin/npm")
                };
                if npm_path.is_file() {
                    candidates.push(npm_path);
                }
            }
        }
    }

    let mut seen = std::collections::HashSet::new();
    candidates
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

fn latest_npm_package_version(package_name: &str) -> Result<String, String> {
    let mut errors = Vec::new();
    for npm in npm_command_candidates() {
        let mut command = Command::new(&npm);
        if let Some(path_env) = enhanced_path_env(Some(&npm)) {
            command.env("PATH", path_env);
        }
        let output = command
            .args(["view", package_name, "version", "--json"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output();
        let Ok(output) = output else {
            errors.push(format!(
                "{}: command failed to start: {}",
                npm.display(),
                output
                    .err()
                    .map(|error| error.to_string())
                    .unwrap_or_default()
            ));
            continue;
        };
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            errors.push(if stderr.is_empty() {
                format!("{} exited with {}", npm.display(), output.status)
            } else {
                stderr
            });
            continue;
        }
        let raw = String::from_utf8_lossy(&output.stdout)
            .trim()
            .trim_matches('"')
            .to_string();
        if !raw.is_empty() {
            return Ok(raw);
        }
    }
    Err(if errors.is_empty() {
        "npm command not found".to_string()
    } else {
        errors.join("; ")
    })
}

fn extract_semver(value: &str) -> Option<String> {
    value.split_whitespace().find_map(|part| {
        let candidate = part.trim_matches(|character: char| {
            !character.is_ascii_alphanumeric()
                && character != '.'
                && character != '-'
                && character != '+'
        });
        let mut pieces = candidate.split('.');
        let major = pieces.next()?;
        let minor = pieces.next()?;
        if major.chars().all(|character| character.is_ascii_digit())
            && minor.chars().all(|character| character.is_ascii_digit())
        {
            Some(candidate.to_string())
        } else {
            None
        }
    })
}

fn compare_semver(left: &str, right: &str) -> std::cmp::Ordering {
    let parse = |value: &str| {
        value
            .split(|character: char| character == '.' || character == '-' || character == '+')
            .take(3)
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    let mut left_parts = parse(left);
    let mut right_parts = parse(right);
    left_parts.resize(3, 0);
    right_parts.resize(3, 0);
    left_parts.cmp(&right_parts)
}

fn openclaw_cli_status_blocking() -> OpenClawCliStatus {
    let command_path = resolve_openclaw_command().filter(|path| path.is_file());
    let installed_version = command_path.as_ref().and_then(|path| {
        let output = openclaw_command(path)
            .arg("--version")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let raw = String::from_utf8_lossy(&output.stdout);
        extract_semver(&raw)
    });

    let (latest_version, latest_check_error) = if command_path.is_some() {
        match latest_npm_package_version("openclaw") {
            Ok(version) => (Some(version), None),
            Err(error) => (None, Some(error)),
        }
    } else {
        (None, None)
    };

    let update_available = installed_version
        .as_deref()
        .zip(latest_version.as_deref())
        .map(|(installed, latest)| compare_semver(installed, latest) == std::cmp::Ordering::Less)
        .unwrap_or(false);

    OpenClawCliStatus {
        installed: command_path.is_some(),
        path: command_path.map(|path| path.display().to_string()),
        installed_version,
        latest_version,
        update_available,
        latest_check_error,
    }
}

#[tauri::command]
async fn openclaw_cli_status() -> Result<OpenClawCliStatus, String> {
    tauri::async_runtime::spawn_blocking(openclaw_cli_status_blocking)
        .await
        .map_err(|error| format!("failed to check OpenClaw CLI status: {error}"))
}

fn installed_plugin_from_registry(plugin_id: &str, package_name: &str) -> Option<(String, bool)> {
    let output = run_openclaw_command(&["plugins", "list", "--json"]).ok()?;
    if !output.status.success() {
        return None;
    }
    let json: Value = serde_json::from_slice(&output.stdout).ok()?;
    let plugins = json.get("plugins").and_then(Value::as_array)?;
    plugins.iter().find_map(|plugin| {
        let id_matches = plugin.get("id").and_then(Value::as_str) == Some(plugin_id);
        let name_matches = plugin.get("name").and_then(Value::as_str) == Some(package_name);
        if !id_matches && !name_matches {
            return None;
        }
        let version = plugin
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let enabled = plugin
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        Some((version, enabled))
    })
}

fn weixin_plugin_status_blocking() -> WeixinPluginStatus {
    const PACKAGE_NAME: &str = "@tencent-weixin/openclaw-weixin";
    const PLUGIN_ID: &str = "openclaw-weixin";

    let installed = installed_plugin_from_registry(PLUGIN_ID, PACKAGE_NAME);
    let (latest_version, latest_check_error) = if installed.is_some() {
        match latest_npm_package_version(PACKAGE_NAME) {
            Ok(version) => (Some(version), None),
            Err(error) => (None, Some(error)),
        }
    } else {
        (None, None)
    };

    let installed_version = installed
        .as_ref()
        .map(|(version, _)| version.clone())
        .filter(|version| !version.is_empty());
    let update_available = installed_version
        .as_deref()
        .zip(latest_version.as_deref())
        .map(|(installed, latest)| compare_semver(installed, latest) == std::cmp::Ordering::Less)
        .unwrap_or(false);

    WeixinPluginStatus {
        installed: installed.is_some(),
        enabled: installed
            .as_ref()
            .map(|(_, enabled)| *enabled)
            .unwrap_or(false),
        installed_version,
        latest_version,
        update_available,
        latest_check_error,
    }
}

#[tauri::command]
async fn weixin_plugin_status() -> Result<WeixinPluginStatus, String> {
    tauri::async_runtime::spawn_blocking(weixin_plugin_status_blocking)
        .await
        .map_err(|error| format!("failed to check WeChat plugin status: {error}"))
}

fn ensure_weixin_plugin_enabled_blocking() -> Result<String, String> {
    let enable_output = run_openclaw_command(&[
        "config",
        "set",
        "plugins.entries.openclaw-weixin.enabled",
        "true",
    ])?;
    if !enable_output.status.success() {
        return Err(String::from_utf8_lossy(&enable_output.stderr)
            .trim()
            .to_string());
    }

    let restart_output = run_openclaw_command(&["gateway", "restart"])?;
    if !restart_output.status.success() {
        let stderr = String::from_utf8_lossy(&restart_output.stderr)
            .trim()
            .to_string();
        return Ok(if stderr.is_empty() {
            "WeChat 插件已启用，但 Gateway 重启状态未知。".to_string()
        } else {
            format!("WeChat 插件已启用，但 Gateway 重启失败：{stderr}")
        });
    }

    Ok("WeChat 插件已启用，并已重启 Gateway。".to_string())
}

#[tauri::command]
async fn ensure_weixin_plugin_enabled() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(ensure_weixin_plugin_enabled_blocking)
        .await
        .map_err(|error| format!("failed to enable WeChat plugin: {error}"))?
}

#[tauri::command]
fn open_weixin_plugin_install_terminal() -> Result<String, String> {
    if installed_plugin_from_registry("openclaw-weixin", "@tencent-weixin/openclaw-weixin")
        .is_some()
    {
        return ensure_weixin_plugin_enabled_blocking();
    }

    let install =
        openclaw_terminal_command(&["plugins", "install", "npm:@tencent-weixin/openclaw-weixin"])?;
    let enable = openclaw_terminal_command(&[
        "config",
        "set",
        "plugins.entries.openclaw-weixin.enabled",
        "true",
    ])?;
    let restart = openclaw_terminal_command(&["gateway", "restart"])?;
    let command_line = if cfg!(windows) {
        format!("{install}; if ($LASTEXITCODE -eq 0) {{ {enable}; {restart}; Write-Host 'WeChat plugin installed. Return to clawx and refresh connections.' }}")
    } else {
        format!("{install} && {enable} && {restart}; echo 'WeChat plugin install flow finished. Return to clawx and refresh connections.'")
    };
    open_terminal_command(&command_line, "openclaw-weixin install")?;
    Ok("已打开终端安装 WeChat 插件。安装完成后请回到连接页刷新状态。".to_string())
}

#[tauri::command]
fn open_weixin_plugin_update_terminal() -> Result<String, String> {
    let update =
        openclaw_terminal_command(&["plugins", "update", "@tencent-weixin/openclaw-weixin"])?;
    let restart = openclaw_terminal_command(&["gateway", "restart"])?;
    let command_line = if cfg!(windows) {
        format!("{update}; if ($LASTEXITCODE -eq 0) {{ {restart}; Write-Host 'WeChat plugin updated. Return to clawx and refresh connections.' }}")
    } else {
        format!("{update} && {restart}; echo 'WeChat plugin update flow finished. Return to clawx and refresh connections.'")
    };
    open_terminal_command(&command_line, "openclaw-weixin update")?;
    Ok("已打开终端更新 WeChat 插件。更新完成后请回到连接页刷新状态。".to_string())
}

#[tauri::command]
fn open_openclaw_install_terminal() -> Result<String, String> {
    let install_command = if cfg!(windows) {
        "iwr -useb https://openclaw.ai/install.ps1 | iex"
    } else {
        "if curl -fsSL https://openclaw.ai/install.sh | bash; then echo 'OpenClaw install finished. Return to clawx and click re-detect.'; else echo 'Standard installer failed. Retrying with the local prefix installer to avoid global npm permission issues...'; curl -fsSL https://openclaw.ai/install-cli.sh | bash; fi"
    };
    open_terminal_command(install_command, "OpenClaw install")?;
    Ok("已打开终端开始安装 OpenClaw。安装完成后，请回到 Clawx 重新检测。".to_string())
}

#[tauri::command]
fn open_openclaw_update_terminal() -> Result<String, String> {
    let update = openclaw_terminal_command(&["update"])?;
    let command_line = if cfg!(windows) {
        format!("{update}; Write-Host 'OpenClaw update flow finished. Return to clawx and refresh status.'")
    } else {
        format!(
            "{update}; echo 'OpenClaw update flow finished. Return to clawx and refresh status.'"
        )
    };
    open_terminal_command(&command_line, "OpenClaw update")?;
    Ok("已打开终端更新 OpenClaw。更新完成后，请回到 Clawx 刷新状态。".to_string())
}

fn openclaw_gateway_service_command(action: &'static str) -> Result<String, String> {
    let output = run_openclaw_command(&["gateway", action])?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("openclaw gateway {action} exited with {}", output.status)
        };
        Err(detail)
    }
}

fn pet_manifest_path(path: &Path) -> Option<PathBuf> {
    if path.is_file() && path.extension().and_then(|value| value.to_str()) == Some("json") {
        return Some(path.to_path_buf());
    }
    ["pet.json", "manifest.json", "codex-pet.json"]
        .iter()
        .map(|file_name| path.join(file_name))
        .find(|candidate| candidate.is_file())
}

fn slugify_pet_id(value: &str) -> String {
    let mut slug = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
        } else if (ch == '-' || ch == '_' || ch.is_whitespace()) && !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let trimmed = slug.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "pet".to_string()
    } else {
        trimmed
    }
}

fn codex_pet_atlas() -> PetAtlas {
    PetAtlas {
        columns: 8,
        rows: 9,
        cell_width: 192,
        cell_height: 208,
    }
}

fn codex_pet_animations() -> HashMap<String, PetAnimation> {
    [
        ("idle", 0, vec![280, 110, 110, 140, 140, 320]),
        (
            "running-right",
            1,
            vec![120, 120, 120, 120, 120, 120, 120, 220],
        ),
        (
            "running-left",
            2,
            vec![120, 120, 120, 120, 120, 120, 120, 220],
        ),
        ("waving", 3, vec![140, 140, 140, 280]),
        ("jumping", 4, vec![140, 140, 140, 140, 280]),
        ("failed", 5, vec![140, 140, 140, 140, 140, 140, 140, 240]),
        ("waiting", 6, vec![150, 150, 150, 150, 150, 260]),
        ("running", 7, vec![120, 120, 120, 120, 120, 220]),
        ("review", 8, vec![150, 150, 150, 150, 150, 280]),
    ]
    .into_iter()
    .map(|(state, row, frame_ms)| {
        (
            state.to_string(),
            PetAnimation {
                row,
                frames: frame_ms.len() as u32,
                frame_ms,
            },
        )
    })
    .collect()
}

fn resolve_pet_asset(root_path: &Path, value: Option<String>) -> Option<String> {
    value.map(|asset| root_path.join(asset).to_string_lossy().to_string())
}

fn pet_asset_data_url(path: Option<&str>) -> Option<String> {
    let path = path?;
    let bytes = fs::read(path).ok()?;
    let mime = match Path::new(path).extension().and_then(|value| value.to_str()) {
        Some("webp") => "image/webp",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        _ => "application/octet-stream",
    };
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn read_pet_summary(path: &Path, source: &str) -> Option<PetSummary> {
    let manifest_path = pet_manifest_path(path)?;
    let raw = fs::read_to_string(&manifest_path).ok()?;
    let draft = serde_json::from_str::<PetManifestDraft>(&raw).ok()?;
    let base_name = path
        .file_stem()
        .or_else(|| path.file_name())
        .and_then(|value| value.to_str())
        .unwrap_or("pet");
    let id = draft
        .id
        .as_deref()
        .map(slugify_pet_id)
        .unwrap_or_else(|| slugify_pet_id(base_name));
    let name = draft.name.unwrap_or_else(|| id.clone());
    let species = draft.species.unwrap_or_else(|| "pet".to_string());
    let description = draft
        .description
        .unwrap_or_else(|| "从 Codex pets 目录导入的宠物。".to_string());
    let status = draft.status.unwrap_or_else(|| "idle".to_string());
    let root_path = if path.is_file() {
        path.parent().unwrap_or(path).to_path_buf()
    } else {
        path.to_path_buf()
    };
    let spritesheet = resolve_pet_asset(
        &root_path,
        draft.spritesheet_path.or(draft.spritesheet.clone()),
    );
    let image = resolve_pet_asset(&root_path, draft.image).or_else(|| spritesheet.clone());
    let has_spritesheet = spritesheet.is_some();
    let animations = if draft.animations.is_empty() && has_spritesheet {
        Some(codex_pet_animations())
    } else if draft.animations.is_empty() {
        None
    } else {
        Some(draft.animations)
    };
    Some(PetSummary {
        id,
        name,
        species,
        description,
        status,
        source: source.to_string(),
        path: Some(root_path.to_string_lossy().to_string()),
        icon: draft.icon,
        image,
        spritesheet_data_url: pet_asset_data_url(spritesheet.as_deref()),
        spritesheet,
        atlas: draft
            .atlas
            .or_else(|| has_spritesheet.then(codex_pet_atlas)),
        animations,
        compatible_with: if draft.compatible_with.is_empty() {
            vec!["codex".to_string(), "clawx".to_string()]
        } else {
            draft.compatible_with
        },
    })
}

fn copy_dir_all(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("failed to create {}: {error}", destination.display()))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("failed to read {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("failed to read directory entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("failed to inspect file type: {error}"))?;
        let target = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), &target)
                .map_err(|error| format!("failed to copy {}: {error}", target.display()))?;
        }
    }
    Ok(())
}

fn position_pet_window_bottom_right(window: &WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let Ok(window_size) = window.outer_size() else {
        return;
    };
    let margin = 28_i32;
    let x = monitor_position.x + monitor_size.width as i32 - window_size.width as i32 - margin;
    let y = monitor_position.y + monitor_size.height as i32 - window_size.height as i32 - margin;
    let _ = window.set_position(PhysicalPosition::new(
        x.max(monitor_position.x),
        y.max(monitor_position.y),
    ));
}

#[tauri::command]
async fn list_codex_pets() -> Result<Vec<PetSummary>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut pets = Vec::new();
        for (source, pets_dir) in [
            ("codex", codex_pets_dir()?),
            ("clawkit", clawkit_pets_dir()?),
        ] {
            if !pets_dir.is_dir() {
                continue;
            }
            for entry in fs::read_dir(&pets_dir)
                .map_err(|error| format!("failed to read {}: {error}", pets_dir.display()))?
            {
                let entry = entry.map_err(|error| format!("failed to read pet entry: {error}"))?;
                if let Some(summary) = read_pet_summary(&entry.path(), source) {
                    if !pets.iter().any(|pet: &PetSummary| pet.id == summary.id) {
                        pets.push(summary);
                    }
                }
            }
        }
        Ok(pets)
    })
    .await
    .map_err(|error| format!("failed to list pets: {error}"))?
}

#[tauri::command]
async fn import_codex_pet() -> Result<PetSummary, String> {
    tauri::async_runtime::spawn_blocking(|| {
        ensure_clawkit_home()?;
        let picked = rfd::FileDialog::new()
            .set_title("选择宠物目录或 pet.json")
            .add_filter("Pet manifest", &["json"])
            .pick_folder()
            .or_else(|| rfd::FileDialog::new().set_title("选择 pet.json").add_filter("Pet manifest", &["json"]).pick_file())
            .ok_or_else(|| "未选择宠物文件或目录。".to_string())?;
        let summary = read_pet_summary(&picked, "clawkit").ok_or_else(|| {
            "未找到可识别的宠物清单。请导入包含 pet.json、manifest.json 或 codex-pet.json 的目录。".to_string()
        })?;
        let pets_dir = clawkit_pets_dir()?;
        fs::create_dir_all(&pets_dir).map_err(|error| format!("failed to create {}: {error}", pets_dir.display()))?;
        let target_dir = pets_dir.join(slugify_pet_id(&summary.id));
        if target_dir.exists() {
            return Err(format!("宠物 {} 已存在。", summary.id));
        }
        if picked.is_dir() {
            copy_dir_all(&picked, &target_dir)?;
        } else {
            let source_dir = picked.parent().ok_or_else(|| "无效的宠物文件路径。".to_string())?;
            copy_dir_all(source_dir, &target_dir)?;
        }
        read_pet_summary(&target_dir, "clawkit").ok_or_else(|| "宠物已导入，但无法重新读取清单。".to_string())
    })
    .await
    .map_err(|error| format!("failed to import pet: {error}"))?
}

#[tauri::command]
async fn open_pet_window(app: AppHandle, pet_id: String) -> Result<(), String> {
    let label = "pet";
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show();
        position_pet_window_bottom_right(&window);
        let _ = window.set_focus();
        let _ = window.emit("clawx://pet-selected", pet_id);
        return Ok(());
    }
    let url =
        WebviewUrl::App(format!("index.html?window=pet&petId={}", slugify_pet_id(&pet_id)).into());
    let window = WebviewWindowBuilder::new(&app, label, url)
        .title("Clawx Pet")
        .inner_size(420.0, 300.0)
        .min_inner_size(360.0, 260.0)
        .resizable(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .build()
        .map_err(|error| format!("failed to open pet window: {error}"))?;
    position_pet_window_bottom_right(&window);
    Ok(())
}

#[tauri::command]
async fn openclaw_gateway_start() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| openclaw_gateway_service_command("start"))
        .await
        .map_err(|error| format!("failed to start OpenClaw Gateway: {error}"))?
        .map(|message| {
            if message.is_empty() {
                "OpenClaw Gateway 启动命令已执行。".to_string()
            } else {
                message
            }
        })
}

#[tauri::command]
async fn openclaw_gateway_stop() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| openclaw_gateway_service_command("stop"))
        .await
        .map_err(|error| format!("failed to stop OpenClaw Gateway: {error}"))?
        .map(|message| {
            if message.is_empty() {
                "OpenClaw Gateway 停止命令已执行。".to_string()
            } else {
                message
            }
        })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(RealtimeState::default()))
        .manage(Arc::new(gateway_proxy::GatewayProxyState::default()))
        .plugin(tauri_plugin_opener::init())
        .setup(|_| {
            if let Err(error) = ensure_clawkit_home() {
                eprintln!("failed to initialize .clawkit: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            resolve_dashboard_url,
            load_openclaw_snapshot,
            load_session_record,
            get_clawx_bootstrap_status,
            ensure_clawx_binding,
            resolve_gateway_auth,
            gateway_proxy::gateway_status,
            gateway_proxy::gateway_connect,
            gateway_proxy::gateway_agents_list,
            gateway_proxy::gateway_agents_create,
            gateway_proxy::gateway_agents_update,
            gateway_proxy::gateway_agents_files_list,
            gateway_proxy::gateway_agents_files_get,
            gateway_proxy::gateway_agents_files_set,
            gateway_proxy::gateway_openclaw_status,
            gateway_proxy::gateway_update_status,
            gateway_proxy::gateway_cron_list,
            gateway_proxy::gateway_cron_runs,
            gateway_proxy::gateway_cron_add,
            gateway_proxy::gateway_cron_run,
            gateway_proxy::gateway_cron_update,
            gateway_proxy::gateway_cron_remove,
            gateway_proxy::gateway_health,
            gateway_proxy::gateway_models_auth_status,
            gateway_proxy::gateway_skills_status,
            gateway_proxy::gateway_skills_update,
            gateway_proxy::gateway_channels_status,
            gateway_proxy::gateway_web_login_start,
            gateway_proxy::gateway_web_login_wait,
            gateway_proxy::gateway_sessions_usage,
            gateway_proxy::gateway_sessions_list,
            gateway_proxy::gateway_sessions_preview,
            gateway_proxy::gateway_sessions_subscribe,
            gateway_proxy::gateway_sessions_unsubscribe,
            gateway_proxy::gateway_session_messages_subscribe,
            gateway_proxy::gateway_session_messages_unsubscribe,
            gateway_proxy::gateway_chat_history,
            gateway_proxy::gateway_models_list,
            gateway_proxy::gateway_config_patch,
            gateway_proxy::gateway_config_get,
            gateway_proxy::gateway_chat_send,
            gateway_proxy::gateway_chat_abort,
            gateway_proxy::gateway_sessions_create,
            gateway_proxy::gateway_sessions_patch,
            gateway_proxy::gateway_sessions_compact,
            gateway_proxy::gateway_sessions_reset,
            gateway_proxy::gateway_sessions_delete,
            pick_workspace_directory,
            default_agent_workspace,
            openclaw_cli_status,
            open_model_auth_terminal,
            weixin_plugin_status,
            ensure_weixin_plugin_enabled,
            open_weixin_login_terminal,
            open_weixin_plugin_install_terminal,
            open_weixin_plugin_update_terminal,
            open_openclaw_install_terminal,
            open_openclaw_update_terminal,
            list_codex_pets,
            import_codex_pet,
            open_pet_window,
            openclaw_gateway_start,
            openclaw_gateway_stop,
            subscribe_gateway_realtime,
            unsubscribe_gateway_realtime
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
