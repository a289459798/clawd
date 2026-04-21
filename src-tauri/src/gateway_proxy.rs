use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayClientConfig {
    pub gateway_url: String,
    pub token: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayHistoryResult {
    pub messages: Vec<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewaySendParams {
    pub session_key: String,
    pub message: String,
    pub idempotency_key: String,
    pub model: Option<String>,
    pub thinking: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayHistoryParams {
    pub session_key: String,
    pub limit: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayStatus {
    pub connected: bool,
    pub status_text: String,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct GatewayProxyState {
    pub connected: Mutex<bool>,
    pub status_text: Mutex<String>,
    pub error: Mutex<Option<String>>,
    pub next_id: AtomicU64,
}

fn openclaw_config_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|error| format!("HOME not set: {error}"))?;
    Ok(PathBuf::from(home).join(".openclaw/openclaw.json"))
}

pub fn read_gateway_client_config() -> Result<GatewayClientConfig, String> {
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

    Ok(GatewayClientConfig {
        gateway_url: format!("http://127.0.0.1:{port}"),
        token,
    })
}

fn request_id(state: &GatewayProxyState) -> String {
    format!("clawx-{}", state.next_id.fetch_add(1, Ordering::SeqCst))
}

fn build_gateway_headers(config: &GatewayClientConfig) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    let auth_value = HeaderValue::from_str(&format!("Bearer {}", config.token))
        .map_err(|error| format!("invalid auth header: {error}"))?;
    headers.insert(AUTHORIZATION, auth_value);
    headers.insert("x-openclaw-client-id", HeaderValue::from_static("clawx"));
    headers.insert("x-openclaw-client-version", HeaderValue::from_static(env!("CARGO_PKG_VERSION")));
    Ok(headers)
}

fn call_gateway_http(config: &GatewayClientConfig, method: &str, params: Value) -> Result<Value, String> {
    let client = reqwest::blocking::Client::new();
    let headers = build_gateway_headers(config)?;
    let response = client
        .post(format!("{}/gateway/rpc", config.gateway_url))
        .headers(headers)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": "clawx-http",
            "method": method,
            "params": params,
        }))
        .send()
        .map_err(|error| format!("gateway request failed: {error}"))?;

    let status = response.status();
    let body: Value = response.json().map_err(|error| format!("invalid gateway response: {error}"))?;

    if !status.is_success() {
        let message = body
            .get("error")
            .and_then(|value| value.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("gateway http request failed");
        return Err(message.to_string());
    }

    if let Some(error) = body.get("error") {
        let message = error.get("message").and_then(Value::as_str).unwrap_or("gateway rpc failed");
        return Err(message.to_string());
    }

    Ok(body.get("result").cloned().unwrap_or(Value::Null))
}

#[tauri::command]
pub fn gateway_status(state: tauri::State<Arc<GatewayProxyState>>) -> GatewayStatus {
    GatewayStatus {
        connected: *state.connected.lock().unwrap(),
        status_text: state.status_text.lock().unwrap().clone(),
        error: state.error.lock().unwrap().clone(),
    }
}

#[tauri::command]
pub fn gateway_chat_history(
    state: tauri::State<Arc<GatewayProxyState>>,
    params: GatewayHistoryParams,
) -> Result<GatewayHistoryResult, String> {
    let config = read_gateway_client_config()?;
    *state.connected.lock().unwrap() = true;
    *state.status_text.lock().unwrap() = "Gateway HTTP 代理已连接".to_string();
    *state.error.lock().unwrap() = None;

    let result = call_gateway_http(
        &config,
        "chat.history",
        json!({
            "sessionKey": params.session_key,
            "limit": params.limit.unwrap_or(200),
        }),
    )?;

    Ok(GatewayHistoryResult {
        messages: result
            .get("messages")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
    })
}

#[tauri::command]
pub fn gateway_chat_send(
    app: AppHandle,
    state: tauri::State<Arc<GatewayProxyState>>,
    params: GatewaySendParams,
) -> Result<Value, String> {
    let config = read_gateway_client_config()?;
    *state.connected.lock().unwrap() = true;
    *state.status_text.lock().unwrap() = "Gateway HTTP 代理已连接".to_string();
    *state.error.lock().unwrap() = None;

    let req_id = request_id(&state);
    let result = call_gateway_http(
        &config,
        "chat.send",
        json!({
            "sessionKey": params.session_key,
            "message": params.message,
            "deliver": false,
            "idempotencyKey": params.idempotency_key,
            "model": params.model,
            "thinking": params.thinking,
            "inputProvenance": {
                "kind": "external_user"
            }
        }),
    )?;

    let _ = app.emit("clawx://gateway-send-ack", json!({
        "id": req_id,
        "result": result
    }));

    Ok(result)
}
