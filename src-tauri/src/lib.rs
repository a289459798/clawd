use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize)]
struct AgentSummary {
    id: String,
    name: String,
    workspace: Option<String>,
    model: Option<String>,
    agent_dir: Option<String>,
}

#[derive(Serialize)]
struct SessionSummary {
    id: String,
    agent_id: String,
    key: String,
    title: String,
    updated_at: Option<i64>,
    channel: Option<String>,
    session_file: Option<String>,
    last_message: Option<String>,
    last_role: Option<String>,
    preview_messages: Vec<SessionMessage>,
}

#[derive(Serialize)]
struct SessionMessage {
    role: Option<String>,
    text: String,
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

fn openclaw_config_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|error| format!("HOME not set: {error}"))?;
    Ok(PathBuf::from(home).join(".openclaw/openclaw.json"))
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

fn extract_message_text(value: &Value) -> Option<String> {
    if let Some(content) = value.get("content") {
        if let Some(text) = content.as_str() {
            return Some(text.trim().to_string());
        }
        if let Some(items) = content.as_array() {
            let parts = items
                .iter()
                .filter_map(|item| item.get("text").and_then(Value::as_str))
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>();
            if !parts.is_empty() {
                return Some(parts.join("\n"));
            }
        }
    }
    None
}

fn read_session_preview(session_file: &str) -> (Option<String>, Option<String>, Vec<SessionMessage>) {
    let Ok(content) = fs::read_to_string(session_file) else {
        return (None, None, Vec::new());
    };

    let mut preview_messages = Vec::new();
    let mut last_message = None;
    let mut last_role = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };

        let role = value.get("role").and_then(Value::as_str).map(str::to_string);
        let Some(text) = extract_message_text(&value) else {
            continue;
        };
        let normalized = truncate_text(&text, 280);

        last_message = Some(truncate_text(&text, 120));
        last_role = role.clone();
        preview_messages.push(SessionMessage { role, text: normalized });
    }

    let start = preview_messages.len().saturating_sub(12);
    let preview_messages = preview_messages.into_iter().skip(start).collect::<Vec<_>>();
    (last_message, last_role, preview_messages)
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
            let (last_message, last_role, preview_messages) = session_file
                .as_deref()
                .map(read_session_preview)
                .unwrap_or((None, None, Vec::new()));

            SessionSummary {
                id: entry
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .unwrap_or(key)
                    .to_string(),
                agent_id: agent_id.to_string(),
                key: key.clone(),
                title: entry
                    .get("origin")
                    .and_then(|origin| origin.get("label"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| session_title_from_key(key)),
                updated_at: entry.get("updatedAt").and_then(Value::as_i64),
                channel: entry.get("lastChannel").and_then(Value::as_str).map(str::to_string),
                session_file,
                last_message,
                last_role,
                preview_messages,
            }
        })
        .collect::<Vec<_>>();

    sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    sessions
}

fn read_skills_from_dir(root: &Path) -> Vec<SkillSummary> {
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

#[tauri::command]
fn resolve_dashboard_url() -> Result<String, String> {
    let output = Command::new("openclaw")
        .args(["dashboard", "--no-open"])
        .output()
        .map_err(|error| format!("failed to run openclaw dashboard --no-open: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("openclaw dashboard --no-open failed: {detail}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Some(url) = line.strip_prefix("Dashboard URL: ") {
            return Ok(url.trim().to_string());
        }
    }

    Err("dashboard URL not found in openclaw output".to_string())
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
    let bundled_root = PathBuf::from(&home).join("Workspace/nodejs/clawdbot/skills");
    let user_root = PathBuf::from(&home).join(".agents/skills");

    let mut skills = read_skills_from_dir(&bundled_root);
    skills.extend(read_skills_from_dir(&user_root));
    skills.sort_by(|left, right| left.name.cmp(&right.name));
    skills.dedup_by(|left, right| left.name == right.name);

    Ok(OpenClawSnapshot {
        agents,
        sessions,
        connections,
        skills,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![resolve_dashboard_url, load_openclaw_snapshot])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
