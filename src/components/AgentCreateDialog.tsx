import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type AgentCreateDialogProps = {
  open: boolean;
  creating: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (params: { name: string; workspace: string; emoji?: string }) => void | Promise<void>;
};

function normalizeAgentId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "agent";
}

export function AgentCreateDialog({
  open,
  creating,
  error,
  onClose,
  onCreate,
}: AgentCreateDialogProps) {
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [pickingWorkspace, setPickingWorkspace] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const agentId = useMemo(() => normalizeAgentId(name), [name]);

  useEffect(() => {
    if (!open) return;
    setName("");
    setWorkspace("");
    setPickError(null);
  }, [open]);

  useEffect(() => {
    if (!open || workspace) return;
    setWorkspace(`~/.openclaw/workspace-${agentId}`);
  }, [agentId, open, workspace]);

  if (!open) {
    return null;
  }

  const canSubmit = name.trim().length > 0 && workspace.trim().length > 0 && !creating;

  const chooseWorkspace = async () => {
    setPickingWorkspace(true);
    setPickError(null);
    try {
      const selected = await invoke<string | null>("pick_workspace_directory");
      if (selected) {
        setWorkspace(selected);
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
            <span>{agentId}</span>
          </div>
          <button className="icon-only-button" type="button" onClick={onClose} title="关闭">×</button>
        </div>

        <div className="agent-create-form">
          <div className="agent-create-guidance">
            <strong>Agent 用来隔离身份、记忆和工作目录</strong>
            <p>名称会生成 agent id；工作区会保存 IDENTITY.md、USER.md、SOUL.md 等文件。模型不在这里绑定，后续在每个对话中选择。</p>
          </div>
          <label>
            <span>名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：coding、research、ops" autoFocus />
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
          <div className="agent-create-field-notes">
            <span>建议：名称写职责，工作区选择长期可保留的目录。创建后可在 Agent 身份文件里继续完善能力说明。</span>
          </div>
        </div>

        {error ? <div className="agent-create-error">{error}</div> : null}
        {pickError ? <div className="agent-create-error">{pickError}</div> : null}

        <div className="agent-create-actions">
          <button className="ghost-button" type="button" onClick={onClose} disabled={creating}>取消</button>
          <button
            className="primary-action-button"
            type="button"
            disabled={!canSubmit}
            onClick={() => void onCreate({
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
