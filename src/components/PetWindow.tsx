import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createTranslator, resolveLocale } from "../lib/i18n";
import { mergeClawKitSettings } from "../lib/settingsDefaults";
import type { PetAnimation, PetConversationContext, PetSummary } from "../types/pet";
import "../App.css";

const emptyContext: PetConversationContext = {
  status: "idle",
  lastUserMessage: "/pet",
  lastReply: "Waiting for ClawKit conversation updates.",
  replies: [],
};

function readStoredContext() {
  try {
    let raw = localStorage.getItem("clawkit.petContext");
    if (!raw) {
      raw = localStorage.getItem("clawx.petContext");
      if (raw) {
        localStorage.setItem("clawkit.petContext", raw);
        localStorage.removeItem("clawx.petContext");
      }
    }
    return raw ? { ...emptyContext, ...JSON.parse(raw) } as PetConversationContext : emptyContext;
  } catch {
    return emptyContext;
  }
}

function compactLine(value: string | null | undefined, fallback: string) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function stripMessageTimestamp(value: string) {
  const stripBracketPrefix = (input: string) => input.replace(/^\s*\[(?<stamp>[^\]]{4,80})\]\s*/u, (full, _stamp, _offset, _source, groups) => {
    const stamp = groups?.stamp ?? "";
    const hasDigits = /\d/.test(stamp);
    const hasTimeHint = /[:/\-.]|(?:GMT|UTC)|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)|(?:周|星期)/iu.test(stamp);
    return hasDigits && hasTimeHint ? "" : full;
  });

  const normalized = stripBracketPrefix(value)
    .replace(/^\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:GMT|UTC)?[+-]?\d*\s*/iu, "")
    .replace(/^\s*(?:星期[一二三四五六日天]|周[一二三四五六日天])\s*\d{1,2}:\d{2}(?::\d{2})?\s*/u, "")
    .replace(/^\s*\[(?:\d{1,2}:\d{2}(?::\d{2})?|(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\]\s*/u, "")
    .replace(/^\s*(?:\d{1,2}:\d{2}(?::\d{2})?|(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\s*(?:[-|]\s*)?/u, "")
    .replace(/^\s*(?:GMT|UTC)[+-]?\d{0,2}\s*/iu, "")
    .replace(/^\s*[,，;；]\s*/, "")
    .trim();
  return normalized;
}

function formatBubbleCommand(userMessage: string | null | undefined, title: string | null | undefined) {
  const cleaned = userMessage ? stripMessageTimestamp(userMessage) : "";
  return compactLine(cleaned, title || "OpenClaw");
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

type PetRuntimeState = "idle" | "waiting" | "running" | "failed" | "review";

function resolvePetState(replies: PetConversationContext["replies"], status: string): PetRuntimeState {
  const items = replies ?? [];
  if (items.some((reply) => reply.status === "failed" || reply.status === "error" || reply.status === "stopped")) return "failed";
  if (items.some((reply) => reply.loading)) return "waiting";
  if (items.some((reply) => reply.status === "working") || status === "working") return "running";
  if (items.length > 0) return "review";
  return "idle";
}

function resolveAnimation(pet: PetSummary | null, state: string): PetAnimation | null {
  const animations = pet?.animations ?? null;
  if (!animations) return null;
  return animations[state] ?? animations.review ?? animations.waiting ?? animations.idle ?? null;
}

export function PetWindow() {
  const [t, setT] = useState(() => createTranslator(resolveLocale("auto", typeof navigator !== "undefined" ? navigator.language : null)));
  const initialPetId = new URLSearchParams(window.location.search).get("petId") ?? "";
  const [pets, setPets] = useState<PetSummary[]>([]);
  const [petId, setPetId] = useState(initialPetId);
  const [context, setContext] = useState<PetConversationContext>(readStoredContext);
  const [collapsed, setCollapsed] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [lastExpandedSignature, setLastExpandedSignature] = useState("");
  const [frameIndex, setFrameIndex] = useState(0);
  const [waveOnce, setWaveOnce] = useState(false);
  const [waveToken, setWaveToken] = useState(0);

  useEffect(() => {
    document.documentElement.classList.add("pet-window-document");
    document.body.classList.add("pet-window-body");
    void invoke<PetSummary[]>("list_codex_pets").then(setPets).catch(() => setPets([]));
    const unlistenContext = listen<PetConversationContext>("clawkit://pet-context", (event) => {
      setContext({ ...emptyContext, ...event.payload });
    });
    const unlistenSelected = listen<string>("clawkit://pet-selected", (event) => {
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

  useEffect(() => {
    let cancelled = false;
    void invoke<unknown>("get_clawkit_settings")
      .then((raw) => {
        if (cancelled) return;
        const settings = mergeClawKitSettings(raw);
        const locale = resolveLocale(settings.general.language, typeof navigator !== "undefined" ? navigator.language : null);
        setT(() => createTranslator(locale));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const pet = useMemo(
    () => pets.find((item) => item.id === petId) ?? pets[0] ?? null,
    [petId, pets],
  );
  const replies = context.replies ?? [];
  const busy = replies.some((reply) => reply.loading) || context.status === "working";
  const petState = resolvePetState(replies, context.status);
  const canWaveOnHover = petState === "idle" || petState === "waiting";
  const effectivePetState = waveOnce && canWaveOnHover ? "waving" : petState;
  const animation = resolveAnimation(pet, effectivePetState);
  const atlas = pet?.atlas ?? null;
  const spritesheetSrc = pet?.spritesheetDataUrl ?? (pet?.spritesheet ? convertFileSrc(pet.spritesheet) : null);
  const imageSrc = !spritesheetSrc && pet?.image ? convertFileSrc(pet.image) : null;
  const hasReplies = replies.length > 0;
  const visibleReplies = replies.slice(0, 6);
  const hiddenCount = replies.length;
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

  useEffect(() => {
    void invoke("set_pet_window_expanded", {
      expanded: hasReplies && !collapsed,
      replyCount: visibleReplies.length,
    }).catch(() => undefined);
  }, [hasReplies, collapsed, visibleReplies.length]);

  useEffect(() => {
    setFrameIndex(0);
  }, [pet?.id, effectivePetState, waveToken]);

  useEffect(() => {
    if (!canWaveOnHover) {
      setWaveOnce(false);
    }
  }, [canWaveOnHover]);

  useEffect(() => {
    if (!animation || animation.frames <= 1) {
      if (waveOnce) {
        setWaveOnce(false);
      }
      return;
    }
    const currentFrame = frameIndex % animation.frames;
    const frameMs = animation.frameMs[currentFrame % animation.frameMs.length] ?? 140;
    const timer = window.setTimeout(() => {
      const nextFrame = (currentFrame + 1) % animation.frames;
      setFrameIndex(nextFrame);
      if (waveOnce && effectivePetState === "waving" && nextFrame === 0) {
        setWaveOnce(false);
      }
    }, frameMs);
    return () => window.clearTimeout(timer);
  }, [animation, effectivePetState, frameIndex, waveOnce]);

  const currentFrame = animation ? frameIndex % animation.frames : 0;
  const spriteStyle = spritesheetSrc && atlas && animation ? {
    width: `${atlas.columns * 100}%`,
    height: `${atlas.rows * 100}%`,
    transform: `translate(${-currentFrame * (100 / atlas.columns)}%, ${-animation.row * (100 / atlas.rows)}%)`,
  } as CSSProperties : null;

  const handleStartDrag = (event: React.MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    void getCurrentWindow().startDragging();
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setMenuPosition({ x: event.clientX, y: event.clientY });
  };

  const handlePetMouseEnter = () => {
    if (canWaveOnHover) {
      setFrameIndex(0);
      setWaveOnce(true);
      setWaveToken((value) => value + 1);
    }
  };

  const handlePetMouseLeave = () => {
    // Waving is intentionally one-shot; let the current cycle finish.
  };

  const handlePetClick = () => {
    if (canWaveOnHover) {
      setFrameIndex(0);
      setWaveOnce(true);
      setWaveToken((value) => value + 1);
    }
  };

  return (
    <main
      className={`pet-window-shell ${hasReplies && !collapsed ? "is-expanded" : "is-compact"}`}
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
              <div className="pet-bubble-command">{formatBubbleCommand(reply.userMessage, reply.title)}</div>
              {reply.loading && !reply.reply?.trim() ? (
                <div className="pet-thinking-line" role="status" aria-live="polite">
                  <span>{t("pet.thinking")}</span>
                  <i />
                  <i />
                  <i />
                </div>
              ) : (
                <p>{compactTail(reply.reply, t("pet.thinking"))}</p>
              )}
            </article>
          ))}
        </section>
      ) : null}

      <section
        className={`pet-character-layer ${busy ? "busy" : ""} state-${effectivePetState}`}
      >
        {hasReplies ? (
          <button
            className={`pet-collapse-button ${collapsed ? "collapsed" : ""}`}
            type="button"
            onClick={() => {
              setCollapsed((value) => !value);
              setLastExpandedSignature(replySignature);
            }}
            title={collapsed ? t("pet.showMessages") : t("pet.hideMessages")}
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
        <div
          className={`pet-avatar-large ${spritesheetSrc ? "has-sprite" : ""} ${imageSrc ? "has-image" : ""}`}
          aria-hidden="true"
          onMouseDown={handleStartDrag}
          onContextMenu={handleContextMenu}
          onClick={handlePetClick}
          onMouseEnter={handlePetMouseEnter}
          onMouseLeave={handlePetMouseLeave}
        >
          {spriteStyle && spritesheetSrc ? (
            <div className="pet-sprite-frame">
              <img className="pet-sprite-atlas" src={spritesheetSrc} alt="" style={spriteStyle} />
            </div>
          ) : null}
          {!spriteStyle && imageSrc ? <img src={imageSrc} alt="" /> : null}
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
            {t("pet.closeWindow")}
          </button>
        </div>
      ) : null}
    </main>
  );
}
