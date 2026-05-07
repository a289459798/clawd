import { useEffect, useMemo, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { PetConversationContext, PetSummary } from "../types/pet";

function petGlyph(pet: PetSummary) {
  if (pet.image) return null;
  if (pet.icon === "rock" || pet.species.toLowerCase() === "rock") return "●";
  return "◆";
}

function petImageSrc(path?: string | null) {
  return path ? convertFileSrc(path) : null;
}

export function PetsPage({
  context,
}: {
  context: PetConversationContext;
}) {
  const [pets, setPets] = useState<PetSummary[]>([]);
  const [selectedPetId, setSelectedPetId] = useState("rock");
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
      setSelectedPetId((current) => result.some((pet) => pet.id === current) ? current : result[0]?.id ?? "rock");
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

  const summonPet = async () => {
    if (!selectedPet) return;
    setBusy(true);
    setMessage(null);
    try {
      localStorage.setItem("clawx.petContext", JSON.stringify(context));
      await invoke("open_pet_window", { petId: selectedPet.id });
      setMessage(`${selectedPet.name} 已召唤`);
    } catch (error) {
      setMessage(`召唤失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="workspace-area pets-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Codex pets</p>
          <h1>宠物</h1>
        </div>
        <div className="page-actions">
          <button className="ghost-button" type="button" onClick={() => void refreshPets()} disabled={loading || busy}>
            重新扫描
          </button>
          <button className="ghost-button" type="button" onClick={() => void importPet()} disabled={loading || busy}>
            导入宠物
          </button>
          <button className="primary-button" type="button" onClick={() => void summonPet()} disabled={!selectedPet || loading || busy}>
            召唤
          </button>
        </div>
      </header>

      <div className="pets-layout">
        <div className="pets-list" aria-label="宠物列表">
          {loading ? <p className="empty-state">正在读取 /Users/zhangzy/.codex/pets</p> : null}
          {!loading && pets.length === 0 ? <p className="empty-state">没有找到宠物。</p> : null}
          {pets.map((pet) => (
            (() => {
              const imageSrc = petImageSrc(pet.image);
              return (
            <button
              className={`pet-row ${selectedPetId === pet.id ? "active" : ""}`}
              type="button"
              key={pet.id}
              onClick={() => setSelectedPetId(pet.id)}
            >
              <span className="pet-row-avatar">
                {imageSrc ? <img src={imageSrc} alt="" /> : <span>{petGlyph(pet)}</span>}
              </span>
              <span className="pet-row-main">
                <strong>{pet.name}</strong>
                <span>{pet.source === "builtin" ? "内置" : "Codex 目录"} · {pet.species}</span>
              </span>
              <span className="pet-row-status">{pet.status}</span>
            </button>
              );
            })()
          ))}
        </div>

        <article className="pet-detail-panel">
          {selectedPet ? (
            <>
              <div className="pet-detail-hero">
                <div className="pet-detail-avatar">
                  {petImageSrc(selectedPet.image) ? <img src={petImageSrc(selectedPet.image) ?? ""} alt={selectedPet.name} /> : <span>{petGlyph(selectedPet)}</span>}
                </div>
                <div>
                  <h2>{selectedPet.name}</h2>
                  <p>{selectedPet.description}</p>
                </div>
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
                  <dd>{selectedPet.path ?? "~/.codex/pets"}</dd>
                </div>
              </dl>
              <div className="pet-context-preview">
                <strong>浮窗会显示</strong>
                <p>{context.title ?? "当前未选中会话"}</p>
                <span>{context.status}{context.model ? ` · ${context.model}` : ""}</span>
              </div>
            </>
          ) : null}
        </article>
      </div>
      {message ? <div className="page-inline-message">{message}</div> : null}
    </section>
  );
}
