use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ed25519_dalek::{SigningKey, VerifyingKey};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tungstenite::client::IntoClientRequest;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket, connect};
use url::Url;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayClientConfig {
    pub ws_url: String,
    pub token: String,
}

#[derive(Clone)]
struct DeviceIdentity {
    device_id: String,
    public_key: String,
    signing_key: SigningKey,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayHistoryResult {
    pub messages: Vec<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayAttachmentInput {
    pub data_url: String,
    pub mime_type: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewaySendParams {
    pub session_key: String,
    pub message: String,
    pub idempotency_key: String,
    pub thinking: Option<String>,
    pub attachments: Option<Vec<GatewayAttachmentInput>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayHistoryParams {
    pub session_key: String,
    pub limit: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewaySessionsListParams {
    pub limit: Option<u32>,
    pub active_minutes: Option<u32>,
    pub include_global: Option<bool>,
    pub include_unknown: Option<bool>,
    pub include_derived_titles: Option<bool>,
    pub include_last_message: Option<bool>,
    pub label: Option<String>,
    pub spawned_by: Option<String>,
    pub agent_id: Option<String>,
    pub search: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewaySessionsPreviewParams {
    pub keys: Vec<String>,
    pub limit: Option<u32>,
    pub max_chars: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayAgentCreateParams {
    pub name: String,
    pub workspace: String,
    pub emoji: Option<String>,
    pub avatar: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayAgentUpdateParams {
    pub agent_id: String,
    pub name: Option<String>,
    pub workspace: Option<String>,
    pub emoji: Option<String>,
    pub avatar: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayAgentFilesListParams {
    pub agent_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayAgentFilesGetParams {
    pub agent_id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayAgentFilesSetParams {
    pub agent_id: String,
    pub name: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewaySkillsStatusParams {
    pub agent_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewaySkillsUpdateParams {
    pub skill_key: String,
    pub enabled: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayChannelsStatusParams {
    pub probe: Option<bool>,
    pub timeout_ms: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayWebLoginStartParams {
    pub force: Option<bool>,
    pub timeout_ms: Option<u32>,
    pub verbose: Option<bool>,
    pub account_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayWebLoginWaitParams {
    pub timeout_ms: Option<u32>,
    pub account_id: Option<String>,
    pub current_qr_data_url: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewaySessionsUsageParams {
    pub key: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub mode: Option<String>,
    pub utc_offset: Option<String>,
    pub limit: Option<u32>,
    pub include_context_weight: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayCreateSessionParams {
    pub agent_id: String,
    pub label: Option<String>,
    pub model: Option<String>,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayStatus {
    pub connected: bool,
    pub status_text: String,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayChatEventPayload {
    #[serde(rename = "type")]
    pub event_type: Option<String>,
    pub state: Option<String>,
    pub session_key: Option<String>,
    pub run_id: Option<String>,
    pub message: Option<Value>,
    pub stream: Option<String>,
    pub data: Option<Value>,
    pub error_message: Option<String>,
}

struct RpcRequest {
    id: String,
    method: String,
    params: Value,
    pending: Arc<PendingRpc>,
}

struct PendingRpc {
    result: Mutex<Option<Value>>,
    error: Mutex<Option<String>>,
    condvar: Condvar,
    done: AtomicBool,
}

impl PendingRpc {
    fn new() -> Self {
        PendingRpc {
            result: Mutex::new(None),
            error: Mutex::new(None),
            condvar: Condvar::new(),
            done: AtomicBool::new(false),
        }
    }

    fn set_result(&self, value: Value) {
        let mut result = self.result.lock().unwrap();
        *result = Some(value);
        self.done.store(true, Ordering::SeqCst);
        self.condvar.notify_one();
    }

    fn set_error(&self, error: String) {
        let mut err = self.error.lock().unwrap();
        *err = Some(error);
        self.done.store(true, Ordering::SeqCst);
        self.condvar.notify_one();
    }

    fn wait(&self, timeout_ms: u64) -> Result<Value, String> {
        let result = self.result.lock().unwrap();
        let wait_result = self
            .condvar
            .wait_timeout_while(result, Duration::from_millis(timeout_ms), |r: &mut Option<Value>| {
                r.is_none() && !self.done.load(Ordering::SeqCst)
            })
            .map_err(|e| format!("wait error: {e}"))?;

        if let Some(ref value) = *wait_result.0 {
            return Ok(value.clone());
        }

        let error = self.error.lock().unwrap();
        if let Some(ref err) = *error {
            return Err(err.clone());
        }

        Err("gateway RPC timeout".to_string())
    }
}

#[derive(Default)]
pub struct GatewayProxyState {
    pub connected: Mutex<bool>,
    pub status_text: Mutex<String>,
    pub error: Mutex<Option<String>>,
    pub next_id: AtomicU64,
    rpc_tx: Mutex<Option<std::sync::mpsc::Sender<RpcRequest>>>,
    connect_waiter: Mutex<Option<Arc<PendingRpc>>>,
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
    let port = gateway.get("port").and_then(Value::as_u64).unwrap_or(18789);
    let token = gateway
        .get("auth")
        .and_then(|auth| auth.get("token"))
        .and_then(Value::as_str)
        .ok_or_else(|| "gateway auth token missing".to_string())?
        .to_string();

    Ok(GatewayClientConfig {
        ws_url: format!("ws://127.0.0.1:{port}/gateway"),
        token,
    })
}

type WsStream = WebSocket<MaybeTlsStream<TcpStream>>;

fn raw_stream_mut(stream: &mut MaybeTlsStream<TcpStream>) -> Result<&mut TcpStream, String> {
    match stream {
        MaybeTlsStream::Plain(tcp) => Ok(tcp),
        MaybeTlsStream::Rustls(tls) => Ok(tls.get_mut()),
        _ => Err("unsupported gateway stream type".to_string()),
    }
}

fn normalize_device_metadata_for_auth(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default()
}

fn signing_key_from_pem(pem: &str) -> Result<SigningKey, String> {
    let body = pem
        .lines()
        .filter(|line| !line.starts_with("-----"))
        .collect::<String>();
    let der = base64::engine::general_purpose::STANDARD
        .decode(body.as_bytes())
        .map_err(|error| format!("invalid PEM base64: {error}"))?;

    const PKCS8_PREFIX: &[u8] = &[
        0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
        0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
    ];
    if der.len() < PKCS8_PREFIX.len() + 32 || &der[..PKCS8_PREFIX.len()] != PKCS8_PREFIX {
        return Err("unsupported private key PEM format".to_string());
    }
    let key_bytes: [u8; 32] = der[PKCS8_PREFIX.len()..PKCS8_PREFIX.len() + 32]
        .try_into()
        .map_err(|_| "invalid private key length in PEM".to_string())?;
    Ok(SigningKey::from_bytes(&key_bytes))
}

fn load_or_create_device_identity() -> Result<DeviceIdentity, String> {
    let home = std::env::var("HOME").map_err(|error| format!("HOME not set: {error}"))?;
    let dir = PathBuf::from(&home).join(".openclaw/clawx");
    fs::create_dir_all(&dir).map_err(|error| format!("failed to create {}: {error}", dir.display()))?;
    let identity_path = dir.join("device_identity.json");

    #[derive(Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct StoredDeviceIdentity {
        device_id: String,
        private_key: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct LegacyStoredDeviceIdentity {
        device_id: String,
        private_key_pem: Option<String>,
    }

    let stored = if identity_path.exists() {
        let content = fs::read_to_string(&identity_path)
            .map_err(|error| format!("failed to read {}: {error}", identity_path.display()))?;
        match serde_json::from_str::<StoredDeviceIdentity>(&content) {
            Ok(current) => current,
            Err(_) => {
                let legacy = serde_json::from_str::<LegacyStoredDeviceIdentity>(&content)
                    .map_err(|error| format!("failed to parse {}: {error}", identity_path.display()))?;
                let pem = legacy
                    .private_key_pem
                    .ok_or_else(|| format!("legacy device identity missing privateKeyPem in {}", identity_path.display()))?;
                let signing_key = signing_key_from_pem(&pem)?;
                let migrated = StoredDeviceIdentity {
                    device_id: legacy.device_id,
                    private_key: URL_SAFE_NO_PAD.encode(signing_key.to_bytes()),
                };
                let migrated_content = serde_json::to_string_pretty(&migrated)
                    .map_err(|error| format!("failed to serialize migrated device identity: {error}"))?;
                fs::write(&identity_path, migrated_content)
                    .map_err(|error| format!("failed to write {}: {error}", identity_path.display()))?;
                migrated
            }
        }
    } else {
        let signing_key = SigningKey::generate(&mut OsRng);
        let stored = StoredDeviceIdentity {
            device_id: format!("clawx-{}", rand::random::<u64>()),
            private_key: URL_SAFE_NO_PAD.encode(signing_key.to_bytes()),
        };
        let content = serde_json::to_string_pretty(&stored)
            .map_err(|error| format!("failed to serialize device identity: {error}"))?;
        fs::write(&identity_path, content)
            .map_err(|error| format!("failed to write {}: {error}", identity_path.display()))?;
        stored
    };

    let private_key_bytes = URL_SAFE_NO_PAD
        .decode(stored.private_key.as_bytes())
        .map_err(|error| format!("invalid stored private key encoding: {error}"))?;
    let private_key_array: [u8; 32] = private_key_bytes
        .try_into()
        .map_err(|_| "stored private key must be 32 bytes".to_string())?;
    let signing_key = SigningKey::from_bytes(&private_key_array);
    let verifying_key: VerifyingKey = signing_key.verifying_key();
    let public_key = URL_SAFE_NO_PAD.encode(verifying_key.to_bytes());

    Ok(DeviceIdentity {
        device_id: stored.device_id,
        public_key,
        signing_key,
    })
}

fn sign_connect_payload_v3(
    identity: &DeviceIdentity,
    client_id: &str,
    client_mode: &str,
    role: &str,
    scopes: &[&str],
    signed_at: u64,
    token: &str,
    nonce: &str,
    platform: &str,
    device_family: Option<&str>,
) -> Result<String, String> {
    let payload = [
        "v3".to_string(),
        identity.device_id.clone(),
        client_id.to_string(),
        client_mode.to_string(),
        role.to_string(),
        scopes.join(","),
        signed_at.to_string(),
        token.to_string(),
        nonce.to_string(),
        normalize_device_metadata_for_auth(Some(platform)),
        normalize_device_metadata_for_auth(device_family),
    ]
    .join("|");

    use ed25519_dalek::Signer;
    let signature = identity.signing_key.sign(payload.as_bytes());
    Ok(URL_SAFE_NO_PAD.encode(signature.to_bytes()))
}

fn connect_gateway_socket(config: &GatewayClientConfig) -> Result<WsStream, String> {
    let url = Url::parse(&config.ws_url).map_err(|error| format!("invalid gateway url: {error}"))?;
    let request = url
        .as_str()
        .into_client_request()
        .map_err(|error| format!("failed to build websocket request: {error}"))?;
    let mut request = request;
    request.headers_mut().insert(
        http::header::AUTHORIZATION,
        http::HeaderValue::from_str(&format!("Bearer {}", config.token))
            .map_err(|error| format!("invalid authorization header: {error}"))?,
    );

    let (socket, _response) = connect(request).map_err(|error| format!("gateway websocket connect failed: {error}"))?;
    Ok(socket)
}

fn clear_connection_state(state: &GatewayProxyState, status: &str, error: Option<String>) {
    *state.connected.lock().unwrap() = false;
    *state.status_text.lock().unwrap() = status.to_string();
    *state.error.lock().unwrap() = error;
    *state.rpc_tx.lock().unwrap() = None;
}

fn send_gateway_frame(socket: &mut WsStream, frame: Value) -> Result<(), String> {
    socket
        .send(Message::Text(frame.to_string().into()))
        .map_err(|error| format!("gateway send failed: {error}"))
}

fn send_gateway_request(socket: &mut WsStream, id: &str, method: &str, params: Value) -> Result<(), String> {
    send_gateway_frame(
        socket,
        json!({
            "type": "req",
            "id": id,
            "method": method,
            "params": params,
        }),
    )
}

fn gateway_event_loop(
    mut socket: WsStream,
    app: AppHandle,
    _state: Arc<GatewayProxyState>,
    rx: std::sync::mpsc::Receiver<RpcRequest>,
    token: String,
    device_identity: DeviceIdentity,
) -> Result<(), String> {
    raw_stream_mut(socket.get_mut())?
        .set_read_timeout(Some(Duration::from_millis(200)))
        .map_err(|error| format!("set read timeout failed: {error}"))?;
    raw_stream_mut(socket.get_mut())?
        .set_write_timeout(Some(Duration::from_secs(15)))
        .map_err(|error| format!("set write timeout failed: {error}"))?;

    let mut pending: HashMap<String, Arc<PendingRpc>> = HashMap::new();
    let mut connected = false;
    let mut queued_requests: Vec<RpcRequest> = Vec::new();

    loop {
        while let Ok(req) = rx.try_recv() {
            if connected {
                pending.insert(req.id.clone(), req.pending.clone());
                if let Err(error) = send_gateway_request(&mut socket, &req.id, &req.method, req.params) {
                    if let Some(p) = pending.remove(&req.id) {
                        p.set_error(error.clone());
                    }
                    return Err(error);
                }
            } else {
                queued_requests.push(req);
            }
        }

        match socket.read() {
            Ok(Message::Text(text)) => {
                if let Ok(value) = serde_json::from_str::<Value>(&text) {
                    if value.get("type").and_then(Value::as_str) == Some("event")
                        && value.get("event").and_then(Value::as_str) == Some("connect.challenge")
                    {
                        let nonce = value
                            .get("payload")
                            .and_then(|payload| payload.get("nonce"))
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        let signed_at = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map_err(|error| format!("system clock error: {error}"))?
                            .as_millis() as u64;
                        let client_id = "gateway-client";
                        let client_mode = "backend";
                        let role = "operator";
                        let scopes = ["operator.admin"];
                        let client_platform = std::env::consts::OS;
                        let client_device_family: Option<&str> = None;
                        let signature = sign_connect_payload_v3(
                            &device_identity,
                            client_id,
                            client_mode,
                            role,
                            &scopes,
                            signed_at,
                            &token,
                            nonce,
                            client_platform,
                            client_device_family,
                        )?;
                        let mut client = json!({
                            "id": client_id,
                            "version": env!("CARGO_PKG_VERSION"),
                            "platform": client_platform,
                            "mode": client_mode
                        });
                        if let Some(device_family) = client_device_family {
                            client["deviceFamily"] = json!(device_family);
                        }
                        send_gateway_request(
                            &mut socket,
                            "connect",
                            "connect",
                            json!({
                                "minProtocol": 3,
                                "maxProtocol": 3,
                                "client": client,
                                "role": role,
                                "scopes": scopes,
                                "caps": ["tool-events"],
                                "auth": {
                                    "token": token
                                },
                                "device": {
                                    "id": device_identity.device_id,
                                    "publicKey": device_identity.public_key,
                                    "signature": signature,
                                    "signedAt": signed_at,
                                    "nonce": nonce
                                }
                            }),
                        )?;
                        continue;
                    }

                    if value.get("type").and_then(Value::as_str) == Some("res") {
                        let id = value.get("id").and_then(Value::as_str).unwrap_or_default();
                        if id == "connect" {
                            eprintln!("[clawx gateway] connect response: {}", value);
                            let ok = value.get("ok").and_then(Value::as_bool).unwrap_or(false);
                            if !ok {
                                let msg = value
                                    .get("error")
                                    .and_then(|error| error.get("message"))
                                    .and_then(Value::as_str)
                                    .unwrap_or("gateway connect failed")
                                    .to_string();
                                if let Some(waiter) = _state.connect_waiter.lock().unwrap().take() {
                                    waiter.set_error(msg.clone());
                                }
                                return Err(msg);
                            }
                            connected = true;
                            *_state.connected.lock().unwrap() = true;
                            *_state.status_text.lock().unwrap() = "Gateway 已连接".to_string();
                            *_state.error.lock().unwrap() = None;
                            if let Some(waiter) = _state.connect_waiter.lock().unwrap().take() {
                                waiter.set_result(json!({"ok": true}));
                            }
                            for req in queued_requests.drain(..) {
                                pending.insert(req.id.clone(), req.pending.clone());
                                if let Err(error) = send_gateway_request(&mut socket, &req.id, &req.method, req.params) {
                                    if let Some(p) = pending.remove(&req.id) {
                                        p.set_error(error.clone());
                                    }
                                    return Err(error);
                                }
                            }
                            continue;
                        }

                        if let Some(p) = pending.remove(id) {
                            eprintln!("[clawx gateway] rpc response id={} frame={}", id, value);
                            let ok = value.get("ok").and_then(Value::as_bool).unwrap_or(false);
                            if ok {
                                let result = value
                                    .get("payload")
                                    .cloned()
                                    .or_else(|| value.get("result").cloned())
                                    .unwrap_or_else(|| value.clone());
                                p.set_result(result);
                            } else {
                                let msg = value
                                    .get("error")
                                    .and_then(|error| error.get("message"))
                                    .and_then(Value::as_str)
                                    .or_else(|| value.get("message").and_then(Value::as_str))
                                    .unwrap_or("unknown")
                                    .to_string();
                                p.set_error(msg);
                            }
                            continue;
                        }
                    }
                    handle_message(&app, value);
                }
            }
            Ok(Message::Binary(_)) => {}
            Ok(Message::Close(frame)) => {
                eprintln!("[clawx gateway] websocket close: {:?}", frame);
                return Err(format!("gateway websocket closed: {:?}", frame));
            }
            Ok(Message::Ping(payload)) => {
                socket
                    .send(Message::Pong(payload))
                    .map_err(|error| format!("gateway pong failed: {error}"))?;
            }
            Ok(Message::Pong(_)) => {}
            Ok(Message::Frame(_)) => {}
            Err(tungstenite::Error::Io(error))
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(error) => return Err(format!("gateway read failed: {error}")),
        }
    }
}

fn handle_message(app: &AppHandle, value: Value) {
    if value.get("type").and_then(Value::as_str) == Some("event")
        && value.get("event").and_then(Value::as_str) == Some("chat")
    {
        eprintln!("[clawx gateway] received chat event: {:?}", value);
        let payload = value.get("payload").cloned().unwrap_or(json!({}));
        let evt = GatewayChatEventPayload {
            event_type: payload.get("type").and_then(Value::as_str).map(str::to_string),
            state: payload.get("state").and_then(Value::as_str).map(str::to_string),
            session_key: payload.get("sessionKey").and_then(Value::as_str).map(str::to_string),
            run_id: payload.get("runId").and_then(Value::as_str).map(str::to_string),
            message: payload.get("message").cloned(),
            stream: payload.get("stream").and_then(Value::as_str).map(str::to_string),
            data: payload.get("data").cloned(),
            error_message: payload.get("errorMessage").and_then(Value::as_str).map(str::to_string),
        };
        let _ = app.emit("clawx://gateway-chat", evt);
    }
    if value.get("type").and_then(Value::as_str) == Some("event")
        && value.get("event").and_then(Value::as_str) == Some("sessions.changed")
    {
        let _ = app.emit("clawx://sessions-changed", ());
    }
    if value.get("type").and_then(Value::as_str) == Some("event")
        && value.get("event").and_then(Value::as_str) == Some("session.message")
    {
        let payload = value.get("payload").cloned().unwrap_or(json!({}));
        let _ = app.emit("clawx://session-message", payload);
    }
    // Log all other events too for debugging
    else if value.get("type").and_then(Value::as_str) == Some("event") {
        eprintln!("[clawx gateway] received other event: {:?}", value);
    }
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
pub async fn gateway_connect(
    app: AppHandle,
    state: tauri::State<'_, Arc<GatewayProxyState>>,
) -> Result<String, String> {
    {
        let connected = state.connected.lock().map_err(|e| format!("lock: {e}"))?;
        if *connected {
            return Ok("already connected".to_string());
        }
    }

    let config = read_gateway_client_config()?;
    let token = config.token.clone();
    let socket = connect_gateway_socket(&config)?;
    let device_identity = load_or_create_device_identity()?;
    let (tx, rx) = std::sync::mpsc::channel::<RpcRequest>();

    let connect_waiter = Arc::new(PendingRpc::new());
    {
        let mut tx_guard = state.rpc_tx.lock().map_err(|e| format!("lock: {e}"))?;
        *tx_guard = Some(tx);
        *state.connected.lock().map_err(|e| format!("lock: {e}"))? = false;
        *state.status_text.lock().map_err(|e| format!("lock: {e}"))? = "Gateway 握手中".to_string();
        *state.error.lock().map_err(|e| format!("lock: {e}"))? = None;
        *state.connect_waiter.lock().map_err(|e| format!("lock: {e}"))? = Some(connect_waiter.clone());
    }

    let st = state.inner().clone();
    let main_waiter = connect_waiter.clone();
    thread::spawn(move || {
        let mut first_waiter = Some(connect_waiter);

        // Initial connection.
        let init_result = gateway_event_loop(
            socket, app.clone(), st.clone(), rx,
            token.clone(), device_identity.clone(),
        );
        match init_result {
            Ok(()) => {
                clear_connection_state(&st, "Gateway 已断开", None);
                if let Some(w) = first_waiter.take() {
                    w.set_error("连接意外断开".to_string());
                }
                return;
            }
            Err(ref e) => {
                if let Some(w) = first_waiter.take() {
                    w.set_error(e.clone());
                }
                clear_connection_state(&st, "Gateway 连接已断开", Some(e.clone()));
                eprintln!("gateway websocket loop exited: {e}");
            }
        }
        // Auto-reconnect: up to 10 attempts, 2s-30s exponential backoff.
        let mut delay = Duration::from_secs(2);
        for attempt in 1..=10 {
            *st.status_text.lock().unwrap() =
                format!("Gateway 正在重连... (第 {} 次)", attempt);
            eprintln!("[clawx gateway] reconnect attempt {}", attempt);
            thread::sleep(delay);
            delay = std::cmp::min(delay * 2, Duration::from_secs(30));

            let config = match read_gateway_client_config() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[clawx gateway] reconnect: read config failed: {e}");
                    continue;
                }
            };
            let identity = match load_or_create_device_identity() {
                Ok(i) => i,
                Err(e) => {
                    eprintln!("[clawx gateway] reconnect: device identity failed: {e}");
                    continue;
                }
            };
            let (tx, rx) = std::sync::mpsc::channel::<RpcRequest>();
            *st.rpc_tx.lock().unwrap() = Some(tx);
            *st.error.lock().unwrap() = None;

            match connect_gateway_socket(&config) {
                Ok(new_socket) => {
                    match gateway_event_loop(
                        new_socket, app.clone(), st.clone(), rx,
                        config.token.clone(), identity.clone(),
                    ) {
                        Ok(()) => {
                            // Reconnected and running until next drop.
                            eprintln!("[clawx gateway] reconnected, running until next disconnect");
                            // After this inner event loop exits, try reconnect again.
                        }
                        Err(e2) => {
                            clear_connection_state(&st, "Gateway 连接已断开", Some(e2.clone()));
                            eprintln!("[clawx gateway] reconnect loop exited: {e2}");
                        }
                    }
                }
                Err(e2) => {
                    eprintln!("[clawx gateway] reconnect connect failed: {e2}");
                    continue;
                }
            }
        }

        *st.status_text.lock().unwrap() = "Gateway 重连失败，请重启应用".to_string();
    });

    main_waiter.wait(5000)?;
    Ok("connected".to_string())
}

fn send_rpc(state: &GatewayProxyState, method: &str, params: Value) -> Result<Value, String> {
    {
        let c = state.connected.lock().unwrap();
        if !*c {
            return Err("Gateway 未连接".to_string());
        }
    }

    let id = format!("clawx-{}", state.next_id.fetch_add(1, Ordering::SeqCst));
    let pending = Arc::new(PendingRpc::new());

    {
        let tx_guard = state.rpc_tx.lock().unwrap();
        if let Some(ref tx) = *tx_guard {
            tx.send(RpcRequest {
                id: id.clone(),
                method: method.to_string(),
                params,
                pending: pending.clone(),
            })
            .map_err(|e| format!("send RPC: {e}"))?;
        } else {
            return Err("RPC channel unavailable".to_string());
        }
    }

    pending.wait(15000)
}


#[tauri::command]
pub fn gateway_models_list(
    state: tauri::State<Arc<GatewayProxyState>>,
) -> Result<Value, String> {
    send_rpc(&state, "models.list", json!({}))
}

#[tauri::command]
pub fn gateway_openclaw_status(
    state: tauri::State<Arc<GatewayProxyState>>,
) -> Result<Value, String> {
    send_rpc(&state, "status", json!({}))
}

#[tauri::command]
pub fn gateway_health(
    state: tauri::State<Arc<GatewayProxyState>>,
    probe: Option<bool>,
) -> Result<Value, String> {
    send_rpc(&state, "health", json!({ "probe": probe.unwrap_or(false) }))
}

#[tauri::command]
pub fn gateway_agents_list(
    state: tauri::State<Arc<GatewayProxyState>>,
) -> Result<Value, String> {
    send_rpc(&state, "agents.list", json!({}))
}

#[tauri::command]
pub fn gateway_agents_create(
    state: tauri::State<Arc<GatewayProxyState>>,
    params: GatewayAgentCreateParams,
) -> Result<Value, String> {
    let mut json_params = serde_json::Map::new();
    json_params.insert("name".to_string(), json!(params.name));
    json_params.insert("workspace".to_string(), json!(params.workspace));
    if let Some(emoji) = params.emoji {
        json_params.insert("emoji".to_string(), json!(emoji));
    }
    if let Some(avatar) = params.avatar {
        json_params.insert("avatar".to_string(), json!(avatar));
    }
    send_rpc(&state, "agents.create", Value::Object(json_params))
}

#[tauri::command]
pub fn gateway_agents_update(
    state: tauri::State<Arc<GatewayProxyState>>,
    params: GatewayAgentUpdateParams,
) -> Result<Value, String> {
    let mut json_params = serde_json::Map::new();
    json_params.insert("agentId".to_string(), json!(params.agent_id));
    if let Some(name) = params.name {
        json_params.insert("name".to_string(), json!(name));
    }
    if let Some(workspace) = params.workspace {
        json_params.insert("workspace".to_string(), json!(workspace));
    }
    if let Some(emoji) = params.emoji {
        json_params.insert("emoji".to_string(), json!(emoji));
    }
    if let Some(avatar) = params.avatar {
        json_params.insert("avatar".to_string(), json!(avatar));
    }
    send_rpc(&state, "agents.update", Value::Object(json_params))
}

#[tauri::command]
pub fn gateway_agents_files_list(
    state: tauri::State<Arc<GatewayProxyState>>,
    params: GatewayAgentFilesListParams,
) -> Result<Value, String> {
    send_rpc(&state, "agents.files.list", json!({ "agentId": params.agent_id }))
}

#[tauri::command]
pub fn gateway_agents_files_get(
    state: tauri::State<Arc<GatewayProxyState>>,
    params: GatewayAgentFilesGetParams,
) -> Result<Value, String> {
    send_rpc(&state, "agents.files.get", json!({ "agentId": params.agent_id, "name": params.name }))
}

#[tauri::command]
pub fn gateway_agents_files_set(
    state: tauri::State<Arc<GatewayProxyState>>,
    params: GatewayAgentFilesSetParams,
) -> Result<Value, String> {
    send_rpc(
        &state,
        "agents.files.set",
        json!({ "agentId": params.agent_id, "name": params.name, "content": params.content }),
    )
}

#[tauri::command]
pub fn gateway_skills_status(
    state: tauri::State<Arc<GatewayProxyState>>,
    params: GatewaySkillsStatusParams,
) -> Result<Value, String> {
    let mut json_params = serde_json::Map::new();
    if let Some(agent_id) = params.agent_id {
        json_params.insert("agentId".to_string(), json!(agent_id));
    }
    send_rpc(&state, "skills.status", Value::Object(json_params))
}

#[tauri::command]
pub fn gateway_skills_update(
    state: tauri::State<Arc<GatewayProxyState>>,
    params: GatewaySkillsUpdateParams,
) -> Result<Value, String> {
    let mut json_params = serde_json::Map::new();
    json_params.insert("skillKey".to_string(), json!(params.skill_key));
    if let Some(enabled) = params.enabled {
        json_params.insert("enabled".to_string(), json!(enabled));
    }
    send_rpc(&state, "skills.update", Value::Object(json_params))
}

#[tauri::command]
pub fn gateway_channels_status(
    state: tauri::State<Arc<GatewayProxyState>>,
    params: GatewayChannelsStatusParams,
) -> Result<Value, String> {
    let mut json_params = serde_json::Map::new();
    if let Some(probe) = params.probe {
        json_params.insert("probe".to_string(), json!(probe));
    }
    if let Some(timeout_ms) = params.timeout_ms {
        json_params.insert("timeoutMs".to_string(), json!(timeout_ms));
    }
    send_rpc(&state, "channels.status", Value::Object(json_params))
}

#[tauri::command]
pub fn gateway_web_login_start(
    state: tauri::State<Arc<GatewayProxyState>>,
    params: GatewayWebLoginStartParams,
) -> Result<Value, String> {
    let mut json_params = serde_json::Map::new();
    if let Some(force) = params.force {
        json_params.insert("force".to_string(), json!(force));
    }
    if let Some(timeout_ms) = params.timeout_ms {
        json_params.insert("timeoutMs".to_string(), json!(timeout_ms));
    }
    if let Some(verbose) = params.verbose {
        json_params.insert("verbose".to_string(), json!(verbose));
    }
    if let Some(account_id) = params.account_id {
        json_params.insert("accountId".to_string(), json!(account_id));
    }
    send_rpc(&state, "web.login.start", Value::Object(json_params))
}

#[tauri::command]
pub fn gateway_web_login_wait(
    state: tauri::State<Arc<GatewayProxyState>>,
    params: GatewayWebLoginWaitParams,
) -> Result<Value, String> {
    let mut json_params = serde_json::Map::new();
    if let Some(timeout_ms) = params.timeout_ms {
        json_params.insert("timeoutMs".to_string(), json!(timeout_ms));
    }
    if let Some(account_id) = params.account_id {
        json_params.insert("accountId".to_string(), json!(account_id));
    }
    if let Some(current_qr_data_url) = params.current_qr_data_url {
        json_params.insert("currentQrDataUrl".to_string(), json!(current_qr_data_url));
    }
    send_rpc(&state, "web.login.wait", Value::Object(json_params))
}

#[tauri::command]
pub fn gateway_sessions_usage(
    state: tauri::State<Arc<GatewayProxyState>>,
    params: GatewaySessionsUsageParams,
) -> Result<Value, String> {
    let mut json_params = serde_json::Map::new();
    if let Some(key) = params.key {
        json_params.insert("key".to_string(), json!(key));
    }
    if let Some(start_date) = params.start_date {
        json_params.insert("startDate".to_string(), json!(start_date));
    }
    if let Some(end_date) = params.end_date {
        json_params.insert("endDate".to_string(), json!(end_date));
    }
    if let Some(mode) = params.mode {
        json_params.insert("mode".to_string(), json!(mode));
    }
    if let Some(utc_offset) = params.utc_offset {
        json_params.insert("utcOffset".to_string(), json!(utc_offset));
    }
    if let Some(limit) = params.limit {
        json_params.insert("limit".to_string(), json!(limit));
    }
    if let Some(include_context_weight) = params.include_context_weight {
        json_params.insert("includeContextWeight".to_string(), json!(include_context_weight));
    }
    send_rpc(&state, "sessions.usage", Value::Object(json_params))
}

#[tauri::command]
pub fn gateway_sessions_list(
    state: tauri::State<Arc<GatewayProxyState>>,
    params: GatewaySessionsListParams,
) -> Result<Value, String> {
    let mut json_params = serde_json::Map::new();
    if let Some(limit) = params.limit {
        json_params.insert("limit".to_string(), json!(limit));
    }
    if let Some(active_minutes) = params.active_minutes {
        json_params.insert("activeMinutes".to_string(), json!(active_minutes));
    }
    if let Some(include_global) = params.include_global {
        json_params.insert("includeGlobal".to_string(), json!(include_global));
    }
    if let Some(include_unknown) = params.include_unknown {
        json_params.insert("includeUnknown".to_string(), json!(include_unknown));
    }
    if let Some(include_derived_titles) = params.include_derived_titles {
        json_params.insert("includeDerivedTitles".to_string(), json!(include_derived_titles));
    }
    if let Some(include_last_message) = params.include_last_message {
        json_params.insert("includeLastMessage".to_string(), json!(include_last_message));
    }
    if let Some(label) = params.label {
        json_params.insert("label".to_string(), json!(label));
    }
    if let Some(spawned_by) = params.spawned_by {
        json_params.insert("spawnedBy".to_string(), json!(spawned_by));
    }
    if let Some(agent_id) = params.agent_id {
        json_params.insert("agentId".to_string(), json!(agent_id));
    }
    if let Some(search) = params.search {
        json_params.insert("search".to_string(), json!(search));
    }
    send_rpc(&state, "sessions.list", Value::Object(json_params))
}

#[tauri::command]
pub fn gateway_sessions_preview(
    state: tauri::State<Arc<GatewayProxyState>>,
    params: GatewaySessionsPreviewParams,
) -> Result<Value, String> {
    let mut json_params = serde_json::Map::new();
    json_params.insert("keys".to_string(), json!(params.keys));
    if let Some(limit) = params.limit {
        json_params.insert("limit".to_string(), json!(limit));
    }
    if let Some(max_chars) = params.max_chars {
        json_params.insert("maxChars".to_string(), json!(max_chars));
    }
    send_rpc(&state, "sessions.preview", Value::Object(json_params))
}

#[tauri::command]
pub fn gateway_sessions_subscribe(
    state: tauri::State<Arc<GatewayProxyState>>,
) -> Result<Value, String> {
    send_rpc(&state, "sessions.subscribe", json!({}))
}

#[tauri::command]
pub fn gateway_sessions_unsubscribe(
    state: tauri::State<Arc<GatewayProxyState>>,
) -> Result<Value, String> {
    send_rpc(&state, "sessions.unsubscribe", json!({}))
}

#[tauri::command]
pub fn gateway_session_messages_subscribe(
    state: tauri::State<Arc<GatewayProxyState>>,
    session_key: String,
) -> Result<Value, String> {
    send_rpc(&state, "sessions.messages.subscribe", json!({ "key": session_key }))
}

#[tauri::command]
pub fn gateway_session_messages_unsubscribe(
    state: tauri::State<Arc<GatewayProxyState>>,
    session_key: String,
) -> Result<Value, String> {
    send_rpc(&state, "sessions.messages.unsubscribe", json!({ "key": session_key }))
}

#[tauri::command]
pub fn gateway_chat_history(
    state: tauri::State<Arc<GatewayProxyState>>,
    params: GatewayHistoryParams,
) -> Result<GatewayHistoryResult, String> {
    let result = send_rpc(
        &state,
        "chat.history",
        json!({
            "sessionKey": params.session_key,
            "limit": params.limit.unwrap_or(200),
        }),
    )?;

    let messages = result
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .or_else(|| result.as_array().cloned())
        .unwrap_or_default();
    Ok(GatewayHistoryResult { messages })
}

#[tauri::command]
pub fn gateway_chat_send(
    app: AppHandle,
    state: tauri::State<Arc<GatewayProxyState>>,
    params: GatewaySendParams,
) -> Result<Value, String> {
    let req_id = format!("clawx-{}", state.next_id.fetch_add(1, Ordering::SeqCst));

    let attachments = params.attachments.unwrap_or_default();
    let attachment_payload: Vec<Value> = attachments
        .into_iter()
        .map(|item| {
            let data = item
                .data_url
                .strip_prefix("data:")
                .and_then(|rest| rest.split_once(","))
                .map(|(_, body)| body.to_string())
                .unwrap_or(item.data_url);
            json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": item.mime_type,
                    "data": data,
                }
            })
        })
        .collect();

    eprintln!("[clawx gateway] sending chat message: session={}, message={:?}", params.session_key, params.message);
    let mut chat_params = serde_json::Map::new();
    chat_params.insert("sessionKey".to_string(), json!(params.session_key));
    chat_params.insert("message".to_string(), json!(params.message));
    chat_params.insert("deliver".to_string(), json!(false));
    chat_params.insert("idempotencyKey".to_string(), json!(params.idempotency_key));
    chat_params.insert("attachments".to_string(), json!(attachment_payload));
    if let Some(thinking) = &params.thinking {
        chat_params.insert("thinking".to_string(), json!(thinking));
    }
    let result = send_rpc(
        &state,
        "chat.send",
        Value::Object(chat_params),
    )?;
    eprintln!("[clawx gateway] chat.send result: {:?}", result);

    let _ = app.emit(
        "clawx://gateway-send-ack",
        json!({
            "id": req_id,
            "result": result
        }),
    );

    Ok(result)
}

#[tauri::command]
pub fn gateway_chat_abort(
    state: tauri::State<Arc<GatewayProxyState>>,
    session_key: String,
    run_id: Option<String>,
) -> Result<Value, String> {
    send_rpc(
        &state,
        "chat.abort",
        json!({
            "sessionKey": session_key,
            "runId": run_id,
        }),
    )
}

#[tauri::command]
pub fn gateway_sessions_create(
    state: tauri::State<Arc<GatewayProxyState>>,
    params: GatewayCreateSessionParams,
) -> Result<Value, String> {
    let mut json_params = serde_json::Map::new();
    json_params.insert("agentId".to_string(), json!(params.agent_id));
    
    if let Some(label) = params.label {
        json_params.insert("label".to_string(), json!(label));
    }
    
    if let Some(model) = params.model {
        json_params.insert("model".to_string(), json!(model));
    }
    
    if let Some(message) = params.message {
        json_params.insert("message".to_string(), json!(message));
    }
    
    send_rpc(
        &state,
        "sessions.create",
        Value::Object(json_params),
    )
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewaySessionsPatchParams {
    pub session_key: String,
    pub model: Option<String>,
    pub thinking_level: Option<String>,
    pub fast_mode: Option<bool>,
    pub reasoning_level: Option<String>,
    pub verbose_level: Option<String>,
    pub label: Option<String>,
}

#[tauri::command]
pub fn gateway_sessions_patch(
    state: tauri::State<Arc<GatewayProxyState>>,
    params: GatewaySessionsPatchParams,
) -> Result<Value, String> {
    let mut json_params = serde_json::Map::new();
    json_params.insert("key".to_string(), json!(params.session_key));
    
    if let Some(model) = params.model {
        json_params.insert("model".to_string(), json!(model));
    }
    if let Some(thinking_level) = params.thinking_level {
        json_params.insert("thinkingLevel".to_string(), json!(thinking_level));
    }
    if let Some(fast_mode) = params.fast_mode {
        json_params.insert("fastMode".to_string(), json!(fast_mode));
    }
    if let Some(reasoning_level) = params.reasoning_level {
        json_params.insert("reasoningLevel".to_string(), json!(reasoning_level));
    }
    if let Some(verbose_level) = params.verbose_level {
        json_params.insert("verboseLevel".to_string(), json!(verbose_level));
    }
    if let Some(label) = params.label {
        json_params.insert("label".to_string(), json!(label));
    }
    
    send_rpc(
        &state,
        "sessions.patch",
        Value::Object(json_params),
    )
}
