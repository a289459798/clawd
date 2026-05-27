import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { PetAnimation, PetConversationContext, PetSummary } from "../types/pet";
type TranslateFn = (key: string) => string;
const tt = (t: TranslateFn, key: string, fallback: string) => {
  const value = t(key);
  return value === key ? fallback : value;
};

const statePreviews = [
  { key: "idle", label: "Idle", meta: "Row 0 · 6 frames" },
  { key: "running-right", label: "Run right", meta: "Row 1 · 8 frames" },
  { key: "running-left", label: "Run left", meta: "Row 2 · 8 frames" },
  { key: "waving", label: "Wave", meta: "Row 3 · 4 frames" },
  { key: "jumping", label: "Jump", meta: "Row 4 · 5 frames" },
  { key: "failed", label: "Failed", meta: "Row 5 · 8 frames" },
  { key: "waiting", label: "Waiting", meta: "Row 6 · 6 frames" },
  { key: "running", label: "Running", meta: "Row 7 · 6 frames" },
  { key: "review", label: "Review", meta: "Row 8 · 6 frames" },
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
  t,
}: {
  context: PetConversationContext;
  t: TranslateFn;
}) {
  const [pets, setPets] = useState<PetSummary[]>([]);
  const [selectedPetId, setSelectedPetId] = useState("");
  const [summonedPetId, setSummonedPetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const selectedPet = useMemo(
    () => pets.find((pet) => pet.id === selectedPetId) ?? pets[0] ?? null,
    [pets, selectedPetId],
  );

  const refreshPets = async () => {
    setLoading(true);
    try {
      const result = await invoke<PetSummary[]>("list_codex_pets");
      setPets(result);
      setSelectedPetId((current) => result.some((pet) => pet.id === current) ? current : result[0]?.id ?? "");
    } catch (error) {
      console.warn("Failed to read pets", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshPets();
  }, []);

  const importPet = async () => {
    setBusy(true);
    try {
      const imported = await invoke<PetSummary>("import_codex_pet");
      await refreshPets();
      setSelectedPetId(imported.id);
    } catch (error) {
      console.warn("Failed to import pet or cancelled", error);
    } finally {
      setBusy(false);
    }
  };

  const summonPet = async (pet: PetSummary) => {
    setBusy(true);
    try {
      localStorage.setItem("clawkit.petContext", JSON.stringify(context));
      await invoke("open_pet_window", { petId: pet.id });
      setSummonedPetId(pet.id);
      setSelectedPetId(pet.id);
    } catch (error) {
      console.warn("Failed to summon pet", error);
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

              <div className="pet-state-preview-grid" aria-label={tt(t, "pets.stateAnimations", "Pet state animations")}>
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
                  <dt>{tt(t, "pets.status", "Status")}</dt>
                  <dd>{selectedPet.status}</dd>
                </div>
                <div>
                  <dt>{tt(t, "pets.compatibility", "Compatibility")}</dt>
                  <dd>{selectedPet.compatibleWith.join(", ") || "ClawKit"}</dd>
                </div>
                <div>
                  <dt>{tt(t, "pets.source", "Source")}</dt>
                  <dd>{selectedPet.source === "clawkit" ? "ClawKit" : "Codex"}</dd>
                </div>
              </dl>
            </>
          ) : (
            <div className="pet-detail-empty">
              <strong>{tt(t, "pets.none", "No pets yet")}</strong>
              <span>{tt(t, "pets.noneHint", "After scanning or importing, pets and animations will appear here.")}</span>
            </div>
          )}
        </article>

        <aside className="pets-list-panel">
          <div className="pets-list" aria-label={tt(t, "pets.list", "Pet list")}>
          {loading ? <p className="empty-state">{tt(t, "pets.scanning", "Scanning Codex and ClawKit pet directories")}</p> : null}
          {!loading && pets.length === 0 ? <p className="empty-state">{tt(t, "pets.notFound", "No pets found.")}</p> : null}
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
                <span>{pet.source === "clawkit" ? tt(t, "pets.sourceClawkit", "ClawKit directory") : tt(t, "pets.sourceCodex", "Codex directory")} · {pet.species}</span>
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
                {petSummoned ? tt(t, "pets.summoned", "Summoned") : tt(t, "pets.summon", "Summon")}
              </button>
            </div>
            );
          })}
          </div>
          <div className="pets-list-actions">
            <button className="ghost-button" type="button" onClick={() => void refreshPets()} disabled={loading || busy}>
              {tt(t, "common.refresh", "Refresh")}
            </button>
            <button className="ghost-button" type="button" onClick={() => void importPet()} disabled={loading || busy}>
              {tt(t, "pets.import", "Import")}
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
}
