from pathlib import Path
p = Path('/Users/zhangzy/Workspace/clawx/src/App.tsx')
text = p.read_text()
text = text.replace(
'''type OpenClawSnapshot = {
  agents: Array<{ id: string; name: string; workspace?: string; model?: string; agent_dir?: string }>;
  sessions: SnapshotSession[];
  connections: Array<{ id: string; name: string; enabled: boolean }>;
  skills: Array<{ id: string; name: string; location: string }>;
};
''',
'''type OpenClawSnapshot = {
  agents: Array<{ id: string; name: string; workspace?: string; model?: string; agent_dir?: string }>;
  sessions: SnapshotSession[];
  connections: Array<{ id: string; name: string; enabled: boolean }>;
  skills: Array<{ id: string; name: string; location: string }>;
};

type GatewayAuthInfo = {
  url: string;
  token: string;
};

type GatewayPart =
  | { type: "text"; text: string }
  | { type: "toolcall"; name?: string; arguments?: unknown }
  | { type: "toolresult"; name?: string; text?: string }
  | { type: "image" | "input_image" | "image_url"; data?: string; url?: string; mimeType?: string; mime_type?: string; text?: string; alt?: string; image_url?: { url?: string } };

type GatewayMessage = {
  role?: string;
  content?: GatewayPart[] | string;
  text?: string;
  timestamp?: number;
};

type GatewayChatEvent = {
  type?: string;
  state?: "delta" | "final" | "aborted" | "error";
  sessionKey?: string;
  runId?: string;
  message?: GatewayMessage;
  errorMessage?: string;
};
''')
text = text.replace(
'function App() {',
'''function extractTextFromGatewayMessage(message?: GatewayMessage | null) {
  if (!message) return "";
  if (typeof message.text === "string") return message.text;
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (part.type === "text") return part.text;
        if (part.type === "toolresult") return part.text ?? "";
        return "";
      })
      .join("\\n")
      .trim();
  }
  return "";
}

function mapGatewayContentToParts(message?: GatewayMessage | null): MessagePart[] {
  if (!message) return [];
  if (typeof message.content === "string") {
    return message.content.trim() ? [{ kind: "text", text: message.content }] : [];
  }
  if (Array.isArray(message.content)) {
    return message.content.flatMap((part) => {
      if (part.type === "text") {
        return part.text?.trim() ? [{ kind: "text", text: part.text }] : [];
      }
      if (part.type === "toolcall") {
        return [{ kind: "tool_call", tool: part.name ?? "tool", args: typeof part.arguments === "string" ? part.arguments : JSON.stringify(part.arguments ?? {}, null, 2) }];
      }
      if (part.type === "toolresult") {
        return [{ kind: "tool_result", tool: part.name, text: part.text }];
      }
      if (part.type === "image" || part.type === "input_image" || part.type === "image_url") {
        const src = part.data ?? part.url ?? part.image_url?.url;
        return src ? [{ kind: "image", data: src, mime_type: part.mimeType ?? part.mime_type, alt: part.text ?? part.alt }] : [];
      }
      return [];
    });
  }
  if (typeof message.text === "string" && message.text.trim()) {
    return [{ kind: "text", text: message.text }];
  }
  return [];
}

function App() {''', 1)
text = text.replace(
'''  const [composerFocused, setComposerFocused] = useState(false);
  const [composerValue, setComposerValue] = useState("");
''',
'''  const [composerFocused, setComposerFocused] = useState(false);
  const [composerValue, setComposerValue] = useState("");
  const [composerModel, setComposerModel] = useState("");
  const [composerThinking, setComposerThinking] = useState("off");
  const [sending, setSending] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
''')
text = text.replace(
'''  const aiResponseScrollRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
''',
'''  const aiResponseScrollRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const gatewaySocketRef = useRef<WebSocket | null>(null);
  const gatewayRequestIdRef = useRef(1);
  const gatewayPendingRef = useRef(new Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>());
''')
text = text.replace(
'''  const openLocalOpenClaw = async () => {
''',
'''  const gatewayRequest = useCallback((method: string, params: Record<string, unknown>) => {
    return new Promise<unknown>((resolve, reject) => {
      const ws = gatewaySocketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Gateway 未连接"));
        return;
      }
      const id = gatewayRequestIdRef.current++;
      gatewayPendingRef.current.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }, []);

  const openLocalOpenClaw = async () => {
''',1)
insert_after = text.find('  const visibleConversations = useMemo(() => {')
block = '''  useEffect(() => {
    let disposed = false;

    const connectGateway = async () => {
      try {
        const auth = await invoke<GatewayAuthInfo>("resolve_gateway_auth");
        if (disposed) return;

        const ws = new WebSocket(auth.url);
        gatewaySocketRef.current = ws;

        ws.addEventListener("open", () => {
          ws.send(JSON.stringify({
            id: gatewayRequestIdRef.current++,
            method: "connect",
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: "openclaw-control-ui",
                version: "clawx",
                platform: navigator.platform ?? "desktop",
                mode: "webchat",
                instanceId: `clawx-${Date.now()}`,
              },
              role: "webchat",
              scopes: ["chat.read", "chat.write", "sessions.read", "operator.read"],
              caps: ["tool-events"],
              auth: { token: auth.token },
              userAgent: navigator.userAgent,
              locale: navigator.language,
            },
          }));
        });

        ws.addEventListener("message", (event) => {
          let payload: any;
          try {
            payload = JSON.parse(String(event.data ?? "{}"));
          } catch {
            return;
          }

          if (typeof payload.replyTo === "number") {
            const pending = gatewayPendingRef.current.get(payload.replyTo);
            if (pending) {
              gatewayPendingRef.current.delete(payload.replyTo);
              if (payload.error) pending.reject(new Error(payload.error?.message ?? "Gateway 请求失败"));
              else pending.resolve(payload.result);
            }
            return;
          }

          if (payload.type === "chat") {
            const chat = payload as GatewayChatEvent;
            if (!chat.sessionKey || chat.sessionKey != activeConversationId) return;

            if (chat.state === "delta") {
              const deltaText = extractTextFromGatewayMessage(chat.message);
              if (!deltaText) return;
              setAgents((current) => current.map((agent) => ({
                ...agent,
                conversations: agent.conversations.map((conversation) => {
                  if (conversation.id !== chat.sessionKey) return conversation;
                  const nextMessages = [...(conversation.previewMessages ?? [])];
                  const last = nextMessages[nextMessages.length - 1];
                  if (last?.role === "assistant" && last.text.startsWith("__streaming__")) {
                    last.text = `__streaming__${deltaText}`;
                    last.parts = [{ kind: "text", text: deltaText }];
                  } else {
                    nextMessages.push({ role: "assistant", text: `__streaming__${deltaText}`, parts: [{ kind: "text", text: deltaText }] });
                  }
                  return {
                    ...conversation,
                    status: "working",
                    lastRole: "assistant",
                    lastMessage: deltaText,
                    previewMessages: nextMessages,
                    updatedAt: Date.now(),
                    lastTime: new Date().toLocaleString("zh-CN"),
                  };
                }),
              })));
              return;
            }

            if (chat.state === "final" || chat.state === "aborted") {
              const finalText = extractTextFromGatewayMessage(chat.message);
              const finalParts = mapGatewayContentToParts(chat.message);
              setSending(false);
              setAgents((current) => current.map((agent) => ({
                ...agent,
                conversations: agent.conversations.map((conversation) => {
                  if (conversation.id !== chat.sessionKey) return conversation;
                  const nextMessages = [...(conversation.previewMessages ?? [])];
                  const last = nextMessages[nextMessages.length - 1];
                  if (last?.role === "assistant" && last.text.startsWith("__streaming__")) {
                    if (finalText || finalParts.length > 0) {
                      last.text = finalText || last.text.replace(/^__streaming__/, "");
                      last.parts = finalParts.length > 0 ? finalParts : [{ kind: "text", text: finalText || last.text.replace(/^__streaming__/, "") }];
                    } else {
                      last.text = last.text.replace(/^__streaming__/, "");
                    }
                  } else if (finalText || finalParts.length > 0) {
                    nextMessages.push({ role: "assistant", text: finalText, parts: finalParts });
                  }
                  return {
                    ...conversation,
                    status: "completed",
                    lastRole: "assistant",
                    lastMessage: finalText || conversation.lastMessage,
                    previewMessages: nextMessages,
                    updatedAt: Date.now(),
                    lastTime: new Date().toLocaleString("zh-CN"),
                  };
                }),
              })));
              return;
            }

            if (chat.state === "error") {
              setSending(false);
              setGatewayError(chat.errorMessage ?? "发送失败");
            }
          }
        });
      } catch (error) {
        if (!disposed) {
          setGatewayError(error instanceof Error ? error.message : String(error));
        }
      }
    };

    void connectGateway();

    return () => {
      disposed = true;
      const ws = gatewaySocketRef.current;
      gatewaySocketRef.current = null;
      ws?.close();
      gatewayPendingRef.current.forEach(({ reject }) => reject(new Error("Gateway disconnected")));
      gatewayPendingRef.current.clear();
    };
  }, [activeConversationId]);

'''
text = text[:insert_after] + block + text[insert_after:]
text = text.replace(
'''  const openConversationDetail = (conversationId: string) => {
    setActiveConversationId(conversationId);
    setUserExpanded(false);
  };
''',
'''  const openConversationDetail = async (conversationId: string) => {
    setActiveConversationId(conversationId);
    setUserExpanded(false);
    try {
      const result = await gatewayRequest("chat.history", { sessionKey: conversationId, limit: 200 }) as { messages?: GatewayMessage[] };
      if (Array.isArray(result?.messages)) {
        setAgents((current) => current.map((agent) => ({
          ...agent,
          conversations: agent.conversations.map((conversation) => {
            if (conversation.id !== conversationId) return conversation;
            return {
              ...conversation,
              previewMessages: result.messages!.map((message) => ({
                role: message.role,
                text: extractTextFromGatewayMessage(message),
                parts: mapGatewayContentToParts(message),
              })),
            };
          }),
        })));
      }
    } catch (error) {
      console.error("Failed to load chat history", error);
    }
  };
''')
insert_before_return = text.find('  return (')
handle_send = '''  const handleSend = useCallback(async () => {
    if (!activeConversationId || sending) return;
    const message = composerValue.trim();
    if (!message) return;

    setGatewayError(null);
    setSending(true);

    setAgents((current) => current.map((agent) => ({
      ...agent,
      conversations: agent.conversations.map((conversation) => {
        if (conversation.id !== activeConversationId) return conversation;
        return {
          ...conversation,
          status: "working",
          lastRole: "user",
          lastMessage: message,
          updatedAt: Date.now(),
          lastTime: new Date().toLocaleString("zh-CN"),
          previewMessages: [
            ...(conversation.previewMessages ?? []),
            { role: "user", text: message, parts: [{ kind: "text", text: message }] },
            { role: "assistant", text: "__streaming__", parts: [{ kind: "text", text: "" }] },
          ],
        };
      }),
    })));

    setComposerValue("");

    try {
      await gatewayRequest("chat.send", {
        sessionKey: activeConversationId,
        message,
        deliver: false,
        idempotencyKey: `clawx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setGatewayError(messageText);
      setSending(false);
    }
  }, [activeConversationId, composerValue, gatewayRequest, sending]);

'''
text = text[:insert_before_return] + handle_send + text[insert_before_return:]
text = text.replace('defaultValue="" title="模型">', 'value={composerModel} onChange={(e) => setComposerModel(e.target.value)} title="模型">')
text = text.replace('defaultValue="" title="思考模式">', 'value={composerThinking} onChange={(e) => setComposerThinking(e.target.value)} title="思考模式">')
text = text.replace(
'''                      <textarea
                        className="composer-input"
                        placeholder="输入消息…"
                        onChange={(e) => setComposerValue(e.target.value)}
                        value={composerValue}
                      />
''',
'''                      <textarea
                        className="composer-input"
                        placeholder="输入消息…"
                        onChange={(e) => setComposerValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void handleSend();
                          }
                        }}
                        value={composerValue}
                      />
''')
text = text.replace('className="composer-send-btn" type="button" title="发送" disabled={composerValue.trim().length === 0}>', 'className="composer-send-btn" type="button" title="发送" disabled={composerValue.trim().length === 0 || sending} onClick={() => void handleSend()}>')
text = text.replace('                  </div>\n                </div>', '                  </div>\n                  {gatewayError ? <div className="composer-error-banner">{gatewayError}</div> : null}\n                </div>', 1)
text = text.replace('const isStillStreaming = activeConversation.status === "working" && activeConversation.lastRole !== "assistant";', 'const isStillStreaming = false;')
text = text.replace('messages={afterUser}', 'messages={afterUser.map((m) => m.text.startsWith("__streaming__") ? { ...m, text: m.text.replace(/^__streaming__/, "") } : m)}')
p.write_text(text)
