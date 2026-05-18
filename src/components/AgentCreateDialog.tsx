import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { normalizeAgentId, validateAgentCreateInput } from "../lib/agentCreate";
import { AGENT_TEMPLATES } from "../lib/agentTemplates";

type AgentCreateDialogProps = {
  t: (key: string) => string;
  open: boolean;
  creating: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (params: { agentId: string; name: string; workspace: string; emoji?: string; description?: string }) => void | Promise<void>;
};

export function AgentCreateDialog({
  t,
  open,
  creating,
  error,
  onClose,
  onCreate,
}: AgentCreateDialogProps) {
  const tt = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };
  const [agentIdInput, setAgentIdInput] = useState("");
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [workspaceTouched, setWorkspaceTouched] = useState(false);
  const [pickingWorkspace, setPickingWorkspace] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const agentId = useMemo(() => normalizeAgentId(agentIdInput), [agentIdInput]);
  const validationError = useMemo(
    () => validateAgentCreateInput({ agentId: agentIdInput, name, workspace }),
    [agentIdInput, name, workspace],
  );

  useEffect(() => {
    if (!open) return;
    setAgentIdInput("");
    setName("");
    setWorkspace("");
    setDescription("");
    setSelectedTemplateId(null);
    setWorkspaceTouched(false);
    setPickError(null);
  }, [open]);

  useEffect(() => {
    if (!open || workspaceTouched) return;
    let cancelled = false;
    setWorkspace("");
    void (async () => {
      try {
        const defaultWorkspace = await invoke<string>("default_agent_workspace", { agentId });
        if (!cancelled) {
          setWorkspace(defaultWorkspace);
        }
      } catch (err) {
        if (!cancelled) {
          setPickError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, open, workspaceTouched]);

  if (!open) {
    return null;
  }

  const canSubmit = !validationError && !creating;

  const chooseWorkspace = async () => {
    setPickingWorkspace(true);
    setPickError(null);
    try {
      const selected = await invoke<string | null>("pick_workspace_directory");
      if (selected) {
        setWorkspace(selected);
        setWorkspaceTouched(true);
      }
    } catch (err) {
      setPickError(err instanceof Error ? err.message : String(err));
    } finally {
      setPickingWorkspace(false);
    }
  };

  const applyTemplate = (templateId: string) => {
    const template = AGENT_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    setSelectedTemplateId(template.id);
    setAgentIdInput(template.agentId);
    setName(tt(template.nameKey, template.agentId));
    setDescription(tt(template.descriptionKey, ""));
    setWorkspaceTouched(false);
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="agent-create-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-create-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="agent-create-header">
          <div>
            <h2 id="agent-create-title">{tt("agent.create", "Create agent")}</h2>
          </div>
          <button className="icon-only-button" type="button" onClick={onClose} title={tt("common.close", "Close")}>×</button>
        </div>

        <div className="agent-create-body">
          <div className="agent-create-form">
            <section className="agent-template-panel" aria-labelledby="agent-template-title">
              <div className="agent-template-head">
                <strong id="agent-template-title">{tt("agent.templates.title", "Common agent templates")}</strong>
                <span>{tt("agent.templates.hint", "Choose one to fill the form, then edit anything you need.")}</span>
              </div>
              <div className="agent-template-grid">
                {AGENT_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    className={`agent-template-card ${selectedTemplateId === template.id ? "active" : ""}`}
                    type="button"
                    onClick={() => applyTemplate(template.id)}
                  >
                    <span aria-hidden="true">{template.emoji}</span>
                    <strong>{tt(template.nameKey, template.agentId)}</strong>
                    <small>{tt(template.summaryKey, "")}</small>
                  </button>
                ))}
              </div>
            </section>
            <label>
              <span>{tt("agent.id", "Agent ID")}</span>
              <input value={agentIdInput} onChange={(event) => setAgentIdInput(event.target.value)} placeholder={tt("agent.idPlaceholder", "e.g. coding, research-cn, ops")} autoFocus />
            </label>
            <label>
              <span>{tt("common.name", "Name")}</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder={tt("agent.namePlaceholder", "e.g. Research assistant, Coding assistant")} />
            </label>
            <label>
              <span>{tt("common.workspace", "Workspace")}</span>
              <div className="workspace-picker-row">
                <input value={workspace} readOnly placeholder={tt("agent.selectWorkspace", "Select workspace")} />
                <button className="ghost-button" type="button" onClick={() => void chooseWorkspace()} disabled={pickingWorkspace}>
                  {pickingWorkspace ? tt("common.selecting", "Selecting...") : tt("common.select", "Select")}
                </button>
              </div>
            </label>
            <label>
              <span>{tt("agent.description", "Agent description")}</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={tt("agent.descriptionPlaceholder", "Describe this agent's role, boundaries, and workflow.")}
                rows={8}
              />
            </label>
          </div>

          {validationError && (agentIdInput.trim() || name.trim()) ? <div className="agent-create-error">{validationError}</div> : null}
          {error ? <div className="agent-create-error">{error}</div> : null}
          {pickError ? <div className="agent-create-error">{pickError}</div> : null}
        </div>

        <div className="agent-create-actions">
          <button className="ghost-button" type="button" onClick={onClose} disabled={creating}>{tt("common.cancel", "Cancel")}</button>
          <button
            className="primary-action-button"
            type="button"
            disabled={!canSubmit}
            onClick={() => void onCreate({
              agentId: agentId,
              name: name.trim(),
              workspace: workspace.trim(),
              description: description.trim(),
              emoji: selectedTemplateId ? AGENT_TEMPLATES.find((item) => item.id === selectedTemplateId)?.emoji : undefined,
            })}
          >
            {creating ? tt("agent.creating", "Creating...") : tt("common.create", "Create")}
          </button>
        </div>
      </section>
    </div>
  );
}
