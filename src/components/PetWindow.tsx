import { useEffect, useMemo, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PetConversationContext, PetSummary } from "../types/pet";
import "../App.css";

const emptyContext: PetConversationContext = {
  status: "idle",
  lastUserMessage: "/pet",
  lastReply: "等待 clawx 对话更新。",
  replies: [],
};

function readStoredContext() {
  try {
    const raw = localStorage.getItem("clawx.petContext");
    return raw ? { ...emptyContext, ...JSON.parse(raw) } as PetConversationContext : emptyContext;
  } catch {
    return emptyContext;
  }
}

function glyphForPet(pet: PetSummary | null) {
  if (!pet) return "●";
  if (pet.icon === "rock" || pet.species.toLowerCase() === "rock") return "●";
  return "◆";
}

function compactLine(value: string | null | undefined, fallback: string) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function compactTail(value: string | null | undefined, fallback: string) {
  const raw = value?.trim();
  if (!raw) return fallback;
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const tail = lines.length > 1 ? lines.slice(-2).join("\n") : raw.replace(/\s+/g, " ");
  if (tail.length <= 120) return tail;
  return `…${tail.slice(-120)}`;
}

export function PetWindow() {
  const initialPetId = new URLSearchParams(window.location.search).get("petId") ?? "rock";
  const [pets, setPets] = useState<PetSummary[]>([]);
  const [petId, setPetId] = useState(initialPetId);
  const [context, setContext] = useState<PetConversationContext>(readStoredContext);
  const [collapsed, setCollapsed] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [lastExpandedSignature, setLastExpandedSignature] = useState("");

  useEffect(() => {
    document.documentElement.classList.add("pet-window-document");
    document.body.classList.add("pet-window-body");
    void invoke<PetSummary[]>("list_codex_pets").then(setPets).catch(() => setPets([]));
    const unlistenContext = listen<PetConversationContext>("clawx://pet-context", (event) => {
      setContext({ ...emptyContext, ...event.payload });
    });
    const unlistenSelected = listen<string>("clawx://pet-selected", (event) => {
      setPetId(event.payload);
    });
    const handleGlobalClick = () => setMenuPosition(null);
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuPosition(null);
    };
    window.addEventListener("click", handleGlobalClick);
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      document.documentElement.classList.remove("pet-window-document");
      document.body.classList.remove("pet-window-body");
      window.removeEventListener("click", handleGlobalClick);
      window.removeEventListener("keydown", handleGlobalKeyDown);
      void unlistenContext.then((unlisten) => unlisten());
      void unlistenSelected.then((unlisten) => unlisten());
    };
  }, []);

  const pet = useMemo(
    () => pets.find((item) => item.id === petId) ?? pets.find((item) => item.id === "rock") ?? null,
    [petId, pets],
  );
  const replies = context.replies ?? [];
  const busy = replies.some((reply) => reply.loading) || context.status === "working";
  const imageSrc = pet?.image ? convertFileSrc(pet.image) : null;
  const hasReplies = replies.length > 0;
  const visibleReplies = replies.slice(0, 4);
  const hiddenCount = visibleReplies.length;
  const replySignature = replies.map((reply) => `${reply.conversationId}:${reply.updatedAt ?? ""}:${reply.loading ? "loading" : "done"}`).join("|");

  useEffect(() => {
    if (!hasReplies) {
      setCollapsed(false);
      setLastExpandedSignature("");
      return;
    }
    if (replySignature !== lastExpandedSignature) {
      setCollapsed(false);
      setLastExpandedSignature(replySignature);
    }
  }, [replySignature, hasReplies, lastExpandedSignature]);
  const handleStartDrag = (event: React.MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    void getCurrentWindow().startDragging();
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setMenuPosition({ x: event.clientX, y: event.clientY });
  };

  return (
    <main
      className="pet-window-shell"
      onMouseDown={handleStartDrag}
      onContextMenu={handleContextMenu}
    >
      {hasReplies && !collapsed ? (
        <section className="pet-bubble-list" data-tauri-drag-region>
          {visibleReplies.map((reply) => (
            <article className="pet-bubble" key={reply.conversationId}>
              <div className={`pet-bubble-status ${reply.loading ? "loading" : "completed"}`} aria-hidden="true">
                {reply.loading ? (
                  <span />
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <div className="pet-bubble-command">{compactLine(reply.title, "OpenClaw")}</div>
              {reply.loading ? (
                <div className="pet-thinking-line" role="status" aria-live="polite">
                  <span>正在思考</span>
                  <i />
                  <i />
                  <i />
                </div>
              ) : (
                <p>{compactTail(reply.reply, "正在思考")}</p>
              )}
            </article>
          ))}
        </section>
      ) : null}

      <section className={`pet-character-layer ${busy ? "busy" : ""}`}>
        {hasReplies ? (
          <button
            className={`pet-collapse-button ${collapsed ? "collapsed" : ""}`}
            type="button"
            onClick={() => {
              setCollapsed((value) => !value);
              setLastExpandedSignature(replySignature);
            }}
            title={collapsed ? "显示消息" : "隐藏消息"}
          >
            {collapsed ? (
              hiddenCount
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            )}
          </button>
        ) : null}
        <div className={`pet-avatar-large ${imageSrc ? "has-image" : ""}`} aria-hidden="true">
          {imageSrc ? <img src={imageSrc} alt="" /> : <span>{glyphForPet(pet)}</span>}
        </div>
        <div className="pet-shadow" />
      </section>
      {menuPosition ? (
        <div
          className="pet-context-menu"
          style={{ left: menuPosition.x, top: menuPosition.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => void getCurrentWindow().close()}>
            关闭宠物
          </button>
        </div>
      ) : null}
    </main>
  );
}
