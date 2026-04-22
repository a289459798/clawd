use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::client::IntoClientRequest;
use tungstenite::{connect, Message, WebSocket};
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

fn load_or_create_device_identity() -> Result<DeviceIdentity, String> {
    let home = std::env::var("HOME").map_err(|error| format!("HOME not set: {error}"))?;
    let dir = PathBuf::from(&home).join(".openclaw/clawx");
    fs::create_dir_all(&dir).map_err(|error| format!("failed to create {}: {error}", dir.display()))?;

    let script = r#"
const home = process.env.HOME;
const identityPath = `${home}/.openclaw/clawx/device_identity.json`;
const mod = await import(`file://${home}/.nvm/versions/node/v24.4.1/lib/node_modules/openclaw/dist/device-identity-TBOlRcQx.js`);
const loadOrCreateDeviceIdentity = mod.n;
const publicKeyRawBase64UrlFromPem = mod.i;
const identity = loadOrCreateDeviceIdentity(identityPath);
process.stdout.write(JSON.stringify({
  deviceId: identity.deviceId,
  publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem)
}));
"#;

    let output = Command::new("node")
        .env("HOME", &home)
        .arg("--input-type=module")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("failed to run node for device identity: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "failed to load device identity: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let json: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("failed to parse device identity json: {error}"))?;
    let device_id = json.get("deviceId").and_then(Value::as_str).unwrap_or_default().to_string();
    let public_key = json.get("publicKey").and_then(Value::as_str).unwrap_or_default().to_string();
    if device_id.is_empty() || public_key.is_empty() {
        return Err("invalid device identity payload from openclaw".to_string());
    }

    Ok(DeviceIdentity { device_id, public_key })
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
    let home = std::env::var("HOME").map_err(|error| format!("HOME not set: {error}"))?;
    let scopes_json = serde_json::to_string(scopes).map_err(|error| format!("serialize scopes failed: {error}"))?;
    let script = format!(
        r#"
const home = process.env.HOME;
const mod = await import(`file://${{home}}/.nvm/versions/node/v24.4.1/lib/node_modules/openclaw/dist/device-identity-TBOlRcQx.js`);
const loadOrCreateDeviceIdentity = mod.n;
const signDevicePayload = mod.a;
const identity = loadOrCreateDeviceIdentity(`${{home}}/.openclaw/clawx/device_identity.json`);
const normalizeDeviceMetadataForAuth = (value) => {{
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed ? trimmed.toLowerCase() : '';
}};
const payload = [
  'v3',
  {device_id:?},
  {client_id:?},
  {client_mode:?},
  {role:?},
  ...[{scopes_json}].map((x) => Array.isArray(x) ? x.join(',') : x),
  String({signed_at}),
  {token:?} ?? '',
  {nonce:?},
  normalizeDeviceMetadataForAuth({platform:?}),
  normalizeDeviceMetadataForAuth({device_family_js})
].join('|');
process.stdout.write(signDevicePayload(identity.privateKeyPem, payload));
"#,
        device_id = identity.device_id,
        client_id = client_id,
        client_mode = client_mode,
        role = role,
        scopes_json = scopes_json,
        signed_at = signed_at,
        token = token,
        nonce = nonce,
        platform = platform,
        device_family_js = device_family.map(|s| format!("{s:?}")).unwrap_or("null".to_string()),
    );

    let output = Command::new("node")
        .env("HOME", &home)
        .arg("--input-type=module")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("failed to run node for device signature: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "failed to sign device payload: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let signature = String::from_utf8(output.stdout)
        .map_err(|error| format!("invalid signature output encoding: {error}"))?
        .trim()
        .to_string();
    if signature.is_empty() {
        return Err("empty device signature".to_string());
    }
    Ok(signature)
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
                        send_gateway_request(
                            &mut socket,
                            "connect",
                            "connect",
                            json!({
                                "minProtocol": 3,
                                "maxProtocol": 3,
                                "client": {
                                    "id": client_id,
                                    "version": env!("CARGO_PKG_VERSION"),
                                    "platform": client_platform,
                                    "deviceFamily": client_device_family,
                                    "mode": client_mode
                                },
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
            error_message: payload.get("errorMessage").and_then(Value::as_str).map(str::to_string),
        };
        let _ = app.emit("clawx://gateway-chat", evt);
    }
    if value.get("type").and_then(Value::as_str) == Some("event")
        && value.get("event").and_then(Value::as_str) == Some("sessions.changed")
    {
        let _ = app.emit("clawx://sessions-changed", ());
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
        first_waiter = None;

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
    
    send_rpc(
        &state,
        "sessions.patch",
        Value::Object(json_params),
    )
}
