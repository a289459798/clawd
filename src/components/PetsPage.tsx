import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { PetAnimation, PetConversationContext, PetSummary } from "../types/pet";

const statePreviews = [
  { key: "idle", label: "待机", meta: "第 0 行 · 6 帧" },
  { key: "running-right", label: "向右跑", meta: "第 1 行 · 8 帧" },
  { key: "running-left", label: "向左跑", meta: "第 2 行 · 8 帧" },
  { key: "waving", label: "挥手", meta: "第 3 行 · 4 帧" },
  { key: "jumping", label: "跳跃", meta: "第 4 行 · 5 帧" },
  { key: "failed", label: "失败", meta: "第 5 行 · 8 帧" },
  { key: "waiting", label: "等待", meta: "第 6 行 · 6 帧" },
  { key: "running", label: "奔跑", meta: "第 7 行 · 6 帧" },
  { key: "review", label: "审视", meta: "第 8 行 · 6 帧" },
];

function petGlyph(pet: PetSummary) {
  if (pet.image || pet.spritesheet) return null;
  if (pet.icon === "rock" || pet.species.toLowerCase() === "rock") return "●";
  return "◆";
}

function resolveAnimation(pet: PetSummary, state: string, fallback?: string): PetAnimation | null {
  const animations = pet.animations ?? null;
  if (!animations) return null;
  return animations[state] ?? (fallback ? animations[fallback] : null) ?? animations.idle ?? Object.values(animations)[0] ?? null;
}

function spriteAtlasStyle(pet: PetSummary, animation: PetAnimation, frameIndex: number): CSSProperties | null {
  if ((!pet.spritesheetDataUrl && !pet.spritesheet) || !pet.atlas) return null;
  const currentFrame = frameIndex % animation.frames;
  return {
    width: `${pet.atlas.columns * 100}%`,
    height: `${pet.atlas.rows * 100}%`,
    transform: `translate(${-currentFrame * (100 / pet.atlas.columns)}%, ${-animation.row * (100 / pet.atlas.rows)}%)`,
  };
}

function PetSprite({
  pet,
  state = "idle",
  fallback,
  className = "",
  animated = false,
}: {
  pet: PetSummary;
  state?: string;
  fallback?: string;
  className?: string;
  animated?: boolean;
}) {
  const animation = resolveAnimation(pet, state, fallback);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    setFrameIndex(0);
  }, [pet.id, state, fallback]);

  useEffect(() => {
    if (!animated || !animation || animation.frames <= 1) return;
    const currentFrame = frameIndex % animation.frames;
    const frameMs = animation.frameMs[currentFrame % animation.frameMs.length] ?? 140;
    const timer = window.setTimeout(() => {
      setFrameIndex((value) => (value + 1) % animation.frames);
    }, frameMs);
    return () => window.clearTimeout(timer);
  }, [animated, animation, frameIndex]);

  const atlasStyle = animation ? spriteAtlasStyle(pet, animation, animated ? frameIndex : 0) : null;
  const spritesheetSrc = pet.spritesheetDataUrl ?? (pet.spritesheet ? convertFileSrc(pet.spritesheet) : null);
  if (atlasStyle && spritesheetSrc) {
    return (
      <span className={`pet-sprite-preview ${className}`}>
        <img className="pet-sprite-atlas" src={spritesheetSrc} alt="" style={atlasStyle} />
      </span>
    );
  }
  if (pet.image) return <img src={convertFileSrc(pet.image)} alt="" />;
  return <span>{petGlyph(pet)}</span>;
}

export function PetsPage({
  context,
}: {
  context: PetConversationContext;
}) {
  const [pets, setPets] = useState<PetSummary[]>([]);
  const [selectedPetId, setSelectedPetId] = useState("");
  const [summonedPetId, setSummonedPetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedPet = useMemo(
    () => pets.find((pet) => pet.id === selectedPetId) ?? pets[0] ?? null,
    [pets, selectedPetId],
  );

  const refreshPets = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await invoke<PetSummary[]>("list_codex_pets");
      setPets(result);
      setSelectedPetId((current) => result.some((pet) => pet.id === current) ? current : result[0]?.id ?? "");
    } catch (error) {
      setMessage(`读取宠物失败：${String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshPets();
  }, []);

  const importPet = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const imported = await invoke<PetSummary>("import_codex_pet");
      await refreshPets();
      setSelectedPetId(imported.id);
      setMessage(`已导入 ${imported.name}`);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  const summonPet = async (pet: PetSummary) => {
    setBusy(true);
    setMessage(null);
    try {
      localStorage.setItem("clawx.petContext", JSON.stringify(context));
      await invoke("open_pet_window", { petId: pet.id });
      setSummonedPetId(pet.id);
      setSelectedPetId(pet.id);
      setMessage(null);
    } catch (error) {
      setMessage(`召唤失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="workspace-area pets-page">
      <div className="pets-layout">
        <article className="pet-detail-panel">
          {selectedPet ? (
            <>
              <div className="pet-detail-hero">
                <div className="pet-detail-avatar">
                  <PetSprite pet={selectedPet} state="idle" animated className="pet-detail-sprite" />
                </div>
                <div className="pet-detail-copy">
                  <h2>{selectedPet.name}</h2>
                  <p>{selectedPet.description}</p>
                </div>
              </div>

              <div className="pet-state-preview-grid" aria-label="宠物状态动画">
                {statePreviews.map((item) => (
                  <div className="pet-state-preview" key={item.key}>
                    <div className="pet-state-sprite">
                      <PetSprite pet={selectedPet} state={item.key} animated />
                    </div>
                    <strong>{item.label}</strong>
                    <span>{item.meta}</span>
                  </div>
                ))}
              </div>

              <dl className="pet-meta-grid">
                <div>
                  <dt>状态</dt>
                  <dd>{selectedPet.status}</dd>
                </div>
                <div>
                  <dt>兼容</dt>
                  <dd>{selectedPet.compatibleWith.join(", ") || "clawx"}</dd>
                </div>
                <div>
                  <dt>来源</dt>
                  <dd>{selectedPet.source === "clawkit" ? "Clawkit" : "Codex"}</dd>
                </div>
              </dl>
            </>
          ) : (
            <div className="pet-detail-empty">
              <strong>暂无宠物</strong>
              <span>扫描或导入后会在这里展示宠物形象和状态动画。</span>
            </div>
          )}
        </article>

        <aside className="pets-list-panel">
          <div className="pets-list" aria-label="宠物列表">
          {loading ? <p className="empty-state">正在扫描 Codex 与 Clawkit 宠物目录</p> : null}
          {!loading && pets.length === 0 ? <p className="empty-state">没有找到宠物。</p> : null}
          {pets.map((pet) => {
            const petSummoned = summonedPetId === pet.id;
            return (
            <div
              className={`pet-row ${selectedPetId === pet.id ? "active" : ""}`}
              key={pet.id}
              onClick={() => setSelectedPetId(pet.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedPetId(pet.id);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <span className="pet-row-avatar">
                <PetSprite pet={pet} state="idle" />
              </span>
              <span className="pet-row-main">
                <strong>{pet.name}</strong>
                <span>{pet.source === "clawkit" ? "Clawkit 目录" : "Codex 目录"} · {pet.species}</span>
              </span>
              <button
                className={`pet-row-summon ${petSummoned ? "summoned" : ""}`}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void summonPet(pet);
                }}
                disabled={petSummoned || loading || busy}
              >
                {petSummoned ? "已召唤" : "召唤"}
              </button>
            </div>
            );
          })}
          </div>
          <div className="pets-list-actions">
            <button className="ghost-button" type="button" onClick={() => void refreshPets()} disabled={loading || busy}>
              刷新
            </button>
            <button className="ghost-button" type="button" onClick={() => void importPet()} disabled={loading || busy}>
              导入
            </button>
          </div>
        </aside>
      </div>
      {message ? <div className="page-inline-message">{message}</div> : null}
    </section>
  );
}
