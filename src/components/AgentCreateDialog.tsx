import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { normalizeAgentId, validateAgentCreateInput } from "../lib/agentCreate";

type AgentCreateDialogProps = {
  t: (key: string) => string;
  open: boolean;
  creating: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (params: { agentId: string; name: string; workspace: string; emoji?: string }) => void | Promise<void>;
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

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="agent-create-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-create-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="agent-create-header">
          <div>
            <h2 id="agent-create-title">{tt("agent.create", "Create agent")}</h2>
          </div>
          <button className="icon-only-button" type="button" onClick={onClose} title={tt("common.close", "Close")}>×</button>
        </div>

        <div className="agent-create-form">
          <label>
            <span>Agent ID</span>
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
        </div>

        {validationError && (agentIdInput.trim() || name.trim()) ? <div className="agent-create-error">{validationError}</div> : null}
        {error ? <div className="agent-create-error">{error}</div> : null}
        {pickError ? <div className="agent-create-error">{pickError}</div> : null}

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
            })}
          >
            {creating ? tt("agent.creating", "Creating...") : tt("common.create", "Create")}
          </button>
        </div>
      </section>
    </div>
  );
}
