mod gateway_proxy;

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

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
    Text { text: String },
    ToolCall { tool: String, args: Option<String> },
    ToolResult { tool: Option<String>, text: Option<String> },
    Image { mime_type: Option<String>, data: String, alt: Option<String> },
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
    let home = std::env::var("HOME").map_err(|error| format!("HOME not set: {error}"))?;
    Ok(PathBuf::from(home).join(".openclaw/openclaw.json"))
}

fn clawx_recommended_origin() -> String {
    "tauri://localhost".to_string()
}

fn sessions_store_path(agent_id: &str) -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|error| format!("HOME not set: {error}"))?;
    Ok(PathBuf::from(home).join(format!(".openclaw/agents/{agent_id}/sessions/sessions.json")))
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
        .filter(|line| !line.is_empty() && !line.starts_with("```") && !line.starts_with('{') && !line.starts_with('['))
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
    let message = value.get("message").or_else(|| {
        value.get("type").and_then(Value::as_str).filter(|t| t == &"message")
            .map(|_| value)
    }).unwrap_or(value);
    let Some(content) = message.get("content").or_else(|| value.get("content")) else {
        return Vec::new();
    };

    let is_tool_result = message
        .get("role")
        .and_then(Value::as_str)
        .map(|r| r == "toolResult")
        .unwrap_or(false);
    let tool_name = message.get("toolName").and_then(Value::as_str).map(str::to_string);

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
                parts.push(SessionMessagePart::Text { text: trimmed.to_string() });
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
                    if let Some(text) = item.get("text").and_then(Value::as_str).map(str::trim).filter(|text| !text.is_empty()) {
                        if is_tool_result {
                            parts.push(SessionMessagePart::ToolResult {
                                tool: tool_name.clone(),
                                text: Some(text.to_string()),
                            });
                        } else {
                            parts.push(SessionMessagePart::Text { text: text.to_string() });
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
                            mime_type: item.get("mimeType").or_else(|| item.get("mime_type")).and_then(Value::as_str).map(str::to_string),
                            data,
                            alt: item.get("text").or_else(|| item.get("alt")).and_then(Value::as_str).map(str::to_string),
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

    if lines.is_empty() { None } else { Some(lines.join("\n")) }
}

fn read_usage_fields(value: &Value) -> (Option<u64>, Option<u64>, Option<u64>, Option<u64>, Option<u64>) {
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
    messages: &[(Option<String>, Option<String>, Option<String>, Option<String>, Option<i64>, Vec<SessionMessagePart>, String)],
    cumulative_inputs: &[Option<u64>],
    cumulative_outputs: &[Option<u64>],
    cumulative_cache_read: &[Option<u64>],
    cumulative_cache_write: &[Option<u64>],
) -> Vec<(Option<u64>, Option<u64>, Option<u64>, Option<u64>)> {
    let n = messages.len();
    let mut results = Vec::with_capacity(n);

    for i in 0..n {
        let role = &messages[i].0;
        let is_assistant = role.as_deref().map(|r| r.to_lowercase() == "assistant").unwrap_or(false);

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
            if j_role.as_deref().map(|r| r.to_lowercase() == "assistant").unwrap_or(false) {
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
        return (None, None, None, None, None, None, None, None, None, Vec::new());
    };

    // First pass: collect all messages with their cumulative usage
    type RawMessage = (Option<String>, Option<String>, Option<String>, Option<String>, Option<i64>, Vec<SessionMessagePart>, String);
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

        latest_event_type = value.get("type").and_then(Value::as_str).map(str::to_string);
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
        let model = message_obj.get("model").and_then(Value::as_str).map(str::to_string);
        let provider = message_obj.get("provider").and_then(Value::as_str).map(str::to_string);
        let api = message_obj.get("api").and_then(Value::as_str).map(str::to_string);
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
        raw_messages.push((role, model, provider, api, message_timestamp, parts, normalized));
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
    for (i, (role, model, provider, api, timestamp, parts, text)) in raw_messages.into_iter().enumerate() {
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
        preview_messages.into_iter().skip(index).take(24).collect::<Vec<_>>()
    } else {
        let start = preview_messages.len().saturating_sub(24);
        preview_messages.into_iter().skip(start).collect::<Vec<_>>()
    };
    (
        last_message,
        last_role,
        latest_event_role,
        latest_event_type,
        if has_token_usage { Some(session_input) } else { None },
        if has_token_usage { Some(session_output) } else { None },
        if has_token_usage { Some(session_cache_read) } else { None },
        if has_token_usage { Some(session_cache_write) } else { None },
        if has_token_usage { Some(session_total) } else { None },
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
                .unwrap_or((None, None, None, None, None, None, None, None, None, Vec::new()));

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
                label: entry.get("label").and_then(Value::as_str).map(str::to_string),
                updated_at: entry.get("updatedAt").and_then(Value::as_i64),
                channel: entry.get("lastChannel").and_then(Value::as_str).map(str::to_string),
                session_file,
                last_message,
                last_role,
                latest_event_role,
                latest_event_type,
                input_tokens: entry.get("inputTokens").and_then(Value::as_u64).or(input_tokens),
                output_tokens: entry.get("outputTokens").and_then(Value::as_u64).or(output_tokens),
                cache_read_tokens,
                cache_write_tokens,
                total_tokens: entry.get("totalTokens").and_then(Value::as_u64).or(total_tokens),
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
fn subscribe_gateway_realtime(app: AppHandle, state: State<Arc<RealtimeState>>) -> Result<u64, String> {
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
fn unsubscribe_gateway_realtime(subscription_id: u64, state: State<Arc<RealtimeState>>) -> Result<(), String> {
    state
        .subscribers
        .lock()
        .map_err(|_| "failed to acquire realtime subscribers lock".to_string())?
        .remove(&subscription_id);
    Ok(())
}

#[tauri::command]
fn resolve_dashboard_url() -> Result<String, String> {
    let output = Command::new("openclaw")
        .args(["dashboard", "--no-open"])
        .output()
        .map_err(|error| format!("failed to run openclaw dashboard --no-open: {error}"))?;

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
                        workspace: entry.get("workspace").and_then(Value::as_str).map(str::to_string),
                        model: entry
                            .get("model")
                            .and_then(|model| model.get("primary"))
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        agent_dir: entry.get("agentDir").and_then(Value::as_str).map(str::to_string),
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
                    enabled: entry.get("enabled").and_then(Value::as_bool).unwrap_or(false),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let home = std::env::var("HOME").map_err(|error| format!("HOME not set: {error}"))?;
    let user_root = PathBuf::from(&home).join(".agents/skills");

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
                let (
                    _,
                    _,
                    _,
                    _,
                    _,
                    _,
                    _,
                    _,
                    _,
                    messages,
                ) = read_session_preview(&session_file);
                return Ok(SessionRecordResult { session_file, messages });
            }
        }
    }

    Err(format!("session not found: {session_key}"))
}

#[tauri::command]
fn get_clawx_bootstrap_status() -> Result<ClawxBootstrapStatus, String> {
    let config_path = openclaw_config_path()?;
    let openclaw_path = Command::new("sh")
        .arg("-lc")
        .arg("command -v openclaw")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if path.is_empty() { None } else { Some(path) }
        });

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
            .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default();
        let recommended_origin = clawx_recommended_origin();
        binding_configured = allowed_origins.iter().any(|item| item == &recommended_origin);
        gateway_port = json.get("gateway").and_then(|gateway| gateway.get("port")).and_then(Value::as_u64);
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
        binding_writes: vec![format!("gateway.controlUi.allowedOrigins += {recommended_origin}")],
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
    let root = json.as_object_mut().ok_or_else(|| "invalid config root".to_string())?;
    let gateway = root.entry("gateway".to_string()).or_insert_with(|| serde_json::json!({}));
    if !gateway.is_object() {
        *gateway = serde_json::json!({});
    }
    let gateway_obj = gateway.as_object_mut().ok_or_else(|| "invalid gateway config".to_string())?;
    let control_ui = gateway_obj.entry("controlUi".to_string()).or_insert_with(|| serde_json::json!({}));
    if !control_ui.is_object() {
        *control_ui = serde_json::json!({});
    }
    let control_ui_obj = control_ui.as_object_mut().ok_or_else(|| "invalid controlUi config".to_string())?;
    let allowed = control_ui_obj.entry("allowedOrigins".to_string()).or_insert_with(|| serde_json::json!([]));
    if !allowed.is_array() {
        *allowed = serde_json::json!([]);
    }
    let allowed_arr = allowed.as_array_mut().ok_or_else(|| "invalid allowedOrigins".to_string())?;
    let already = allowed_arr.iter().any(|item| item.as_str() == Some(recommended_origin.as_str()));
    if !already {
        allowed_arr.push(Value::String(recommended_origin));
    }

    let pretty = serde_json::to_string_pretty(&json).map_err(|error| format!("failed to serialize config: {error}"))?;
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

    let gateway = json.get("gateway").ok_or_else(|| "gateway config missing".to_string())?;
    let port = gateway
        .get("port")
        .and_then(Value::as_u64)
        .unwrap_or(18789);
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
fn open_weixin_login_terminal() -> Result<String, String> {
    let status = Command::new("osascript")
        .arg("-e")
        .arg("tell application \"Terminal\" to do script \"openclaw channels login --channel openclaw-weixin\"")
        .arg("-e")
        .arg("tell application \"Terminal\" to activate")
        .status()
        .map_err(|error| format!("failed to open Terminal: {error}"))?;
    if status.success() {
        Ok("已打开终端，请在终端中扫描 openclaw-weixin 登录二维码。".to_string())
    } else {
        Err(format!("openclaw-weixin login terminal exited with status {status}"))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(RealtimeState::default()))
        .manage(Arc::new(gateway_proxy::GatewayProxyState::default()))
        .plugin(tauri_plugin_opener::init())
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
            gateway_proxy::gateway_health,
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
            gateway_proxy::gateway_chat_send,
            gateway_proxy::gateway_chat_abort,
            gateway_proxy::gateway_sessions_create,
            gateway_proxy::gateway_sessions_patch,
            pick_workspace_directory,
            open_weixin_login_terminal,
            subscribe_gateway_realtime,
            unsubscribe_gateway_realtime
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
