import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { buildDefaultAgentWorkspace, normalizeAgentId, validateAgentCreateInput } from "../lib/agentCreate";

type AgentCreateDialogProps = {
  open: boolean;
  creating: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (params: { agentId: string; name: string; workspace: string; emoji?: string }) => void | Promise<void>;
};

export function AgentCreateDialog({
  open,
  creating,
  error,
  onClose,
  onCreate,
}: AgentCreateDialogProps) {
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
    setWorkspace(buildDefaultAgentWorkspace(agentIdInput));
  }, [agentIdInput, open, workspaceTouched]);

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
            <h2 id="agent-create-title">新建 Agent</h2>
          </div>
          <button className="icon-only-button" type="button" onClick={onClose} title="关闭">×</button>
        </div>

        <div className="agent-create-form">
          <label>
            <span>Agent ID</span>
            <input value={agentIdInput} onChange={(event) => setAgentIdInput(event.target.value)} placeholder="例如：coding、research-cn、ops" autoFocus />
          </label>
          <label>
            <span>名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：研究助手、代码助手、运营助手" />
          </label>
          <label>
            <span>工作区</span>
            <div className="workspace-picker-row">
              <input value={workspace} readOnly placeholder="~/.openclaw/workspace-coding" />
              <button className="ghost-button" type="button" onClick={() => void chooseWorkspace()} disabled={pickingWorkspace}>
                {pickingWorkspace ? "选择中" : "选择"}
              </button>
            </div>
          </label>
        </div>

        {validationError && (agentIdInput.trim() || name.trim()) ? <div className="agent-create-error">{validationError}</div> : null}
        {error ? <div className="agent-create-error">{error}</div> : null}
        {pickError ? <div className="agent-create-error">{pickError}</div> : null}

        <div className="agent-create-actions">
          <button className="ghost-button" type="button" onClick={onClose} disabled={creating}>取消</button>
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
            {creating ? "创建中..." : "创建"}
          </button>
        </div>
      </section>
    </div>
  );
}
