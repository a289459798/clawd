import { useEffect, useMemo, useState } from "react";
import type { ModelOption } from "../types/app";

type AgentCreateDialogProps = {
  open: boolean;
  modelOptions: ModelOption[];
  creating: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (params: { name: string; workspace: string; model?: string; emoji?: string }) => void | Promise<void>;
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
  modelOptions,
  creating,
  error,
  onClose,
  onCreate,
}: AgentCreateDialogProps) {
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [model, setModel] = useState("");
  const [emoji, setEmoji] = useState("");
  const agentId = useMemo(() => normalizeAgentId(name), [name]);

  useEffect(() => {
    if (!open) return;
    setName("");
    setWorkspace("");
    setModel(modelOptions[0]?.value ?? "");
    setEmoji("");
  }, [modelOptions, open]);

  useEffect(() => {
    if (!open || workspace) return;
    setWorkspace(`~/.openclaw/workspace-${agentId}`);
  }, [agentId, open, workspace]);

  if (!open) {
    return null;
  }

  const canSubmit = name.trim().length > 0 && workspace.trim().length > 0 && !creating;

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
          <label>
            <span>名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="coding" autoFocus />
          </label>
          <label>
            <span>工作区</span>
            <input value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder="~/.openclaw/workspace-coding" />
          </label>
          <label>
            <span>模型</span>
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              <option value="">继承默认模型</option>
              {modelOptions.map((option) => (
                <option value={option.value} key={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Emoji</span>
            <input value={emoji} onChange={(event) => setEmoji(event.target.value)} placeholder="可选" />
          </label>
        </div>

        {error ? <div className="agent-create-error">{error}</div> : null}

        <div className="agent-create-actions">
          <button className="ghost-button" type="button" onClick={onClose} disabled={creating}>取消</button>
          <button
            className="primary-action-button"
            type="button"
            disabled={!canSubmit}
            onClick={() => void onCreate({
              name: name.trim(),
              workspace: workspace.trim(),
              model: model || undefined,
              emoji: emoji.trim() || undefined,
            })}
          >
            {creating ? "创建中..." : "创建"}
          </button>
        </div>
      </section>
    </div>
  );
}
