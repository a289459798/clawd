import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { describeAgentFile, orderAgentFiles } from "../lib/agentFiles";
import type {
  GatewayAgentFileEntry,
  GatewayAgentsFilesGetResult,
  GatewayAgentsFilesListResult,
  GatewayAgentsFilesSetResult,
} from "../types/gateway";

type AgentFilesDialogProps = {
  open: boolean;
  agentId: string | null;
  agentName?: string;
  onClose: () => void;
};

export function AgentFilesDialog({ open, agentId, agentName, onClose }: AgentFilesDialogProps) {
  const [files, setFiles] = useState<GatewayAgentFileEntry[]>([]);
  const [workspace, setWorkspace] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const fileLoadRequestIdRef = useRef(0);

  const orderedFiles = useMemo(() => orderAgentFiles(files), [files]);
  const selectedFile = useMemo(
    () => orderedFiles.find((file) => file.name === selectedName) ?? orderedFiles[0],
    [orderedFiles, selectedName],
  );
  const isDirty = content !== originalContent;

  const loadFile = useCallback(async (name: string) => {
    if (!agentId) return;
    const requestId = fileLoadRequestIdRef.current + 1;
    fileLoadRequestIdRef.current = requestId;
    setFileLoading(true);
    setError(null);
    setSavedMessage(null);
    try {
      const result = await invoke<GatewayAgentsFilesGetResult>("gateway_agents_files_get", {
        params: { agentId, name },
      });
      if (fileLoadRequestIdRef.current !== requestId) {
        return;
      }
      const nextContent = result.file.content ?? "";
      setContent(nextContent);
      setOriginalContent(nextContent);
      setFiles((current) => orderAgentFiles(current.map((file) => file.name === name ? result.file : file)));
    } catch (err) {
      if (fileLoadRequestIdRef.current !== requestId) {
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fileLoadRequestIdRef.current === requestId) {
        setFileLoading(false);
      }
    }
  }, [agentId]);

  const confirmDiscardChanges = () => {
    if (!isDirty) return true;
    return window.confirm("当前文件有未保存内容，切换或关闭会丢失这些修改。是否继续？");
  };

  const handleClose = () => {
    if (saving || !confirmDiscardChanges()) return;
    fileLoadRequestIdRef.current += 1;
    onClose();
  };

  useEffect(() => {
    if (!open || !agentId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSavedMessage(null);
    setFiles([]);
    setWorkspace("");
    setSelectedName("");
    setContent("");
    setOriginalContent("");
    setFileLoading(false);
    void (async () => {
      try {
        await invoke("gateway_connect");
        const result = await invoke<GatewayAgentsFilesListResult>("gateway_agents_files_list", {
          params: { agentId },
        });
        if (cancelled) return;
        const nextFiles = orderAgentFiles(result.files ?? []);
        setFiles(nextFiles);
        setWorkspace(result.workspace);
        const firstEditable = nextFiles.find((file) => file.name === "AGENTS.md") ?? nextFiles[0];
        if (firstEditable) {
          setSelectedName(firstEditable.name);
          await loadFile(firstEditable.name);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      fileLoadRequestIdRef.current += 1;
    };
  }, [agentId, loadFile, open]);

  const saveSelectedFile = async () => {
    if (!agentId || !selectedFile || saving) return;
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const result = await invoke<GatewayAgentsFilesSetResult>("gateway_agents_files_set", {
        params: { agentId, name: selectedFile.name, content },
      });
      const nextContent = result.file.content ?? content;
      setFiles((current) => orderAgentFiles(current.map((file) => file.name === selectedFile.name ? result.file : file)));
      setContent(nextContent);
      setOriginalContent(nextContent);
      setSavedMessage(`${selectedFile.name} 已保存`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!open || !agentId) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={handleClose}>
      <section className="agent-files-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-files-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="agent-create-header">
          <div>
            <h2 id="agent-files-title">完善 Agent 身份文件</h2>
            <span>{agentName ? `${agentName} · ${agentId}` : agentId}</span>
          </div>
          <button className="icon-only-button" type="button" onClick={handleClose} title="关闭">×</button>
        </div>

        <div className="agent-files-body">
          <aside className="agent-files-list" aria-label="Agent 文件列表">
            <div className="agent-files-workspace">{workspace || "读取工作区中..."}</div>
            {loading ? <div className="agent-files-empty">正在读取文件...</div> : null}
            {!loading && orderedFiles.length === 0 ? <div className="agent-files-empty">暂无可编辑文件</div> : null}
            {orderedFiles.map((file) => (
              <button
                className={`agent-file-tab ${selectedFile?.name === file.name ? "active" : ""}`}
                key={file.name}
                type="button"
                onClick={() => {
                  if (file.name === selectedFile?.name || !confirmDiscardChanges()) {
                    return;
                  }
                  setSelectedName(file.name);
                  void loadFile(file.name);
                }}
              >
                <strong>{file.name}</strong>
                <span>{file.missing ? "待创建" : file.size ? `${file.size} bytes` : "已存在"}</span>
              </button>
            ))}
          </aside>

          <section className="agent-file-editor">
            {selectedFile ? (
              <>
                <div className="agent-file-editor-head">
                  <div>
                    <strong>{selectedFile.name}</strong>
                    <span>{describeAgentFile(selectedFile.name)}</span>
                  </div>
                  {isDirty ? <small>未保存</small> : null}
                </div>
                <textarea
                  value={content}
                  onChange={(event) => {
                    setContent(event.target.value);
                    setSavedMessage(null);
                  }}
                  disabled={fileLoading || saving}
                  spellCheck={false}
                  placeholder={fileLoading ? "读取中..." : "在这里完善 Agent 的身份、职责和工作方式"}
                />
              </>
            ) : (
              <div className="agent-files-empty editor">选择一个文件开始编辑</div>
            )}
          </section>
        </div>

        {error ? <div className="agent-create-error">{error}</div> : null}
        {savedMessage ? <div className="agent-files-saved">{savedMessage}</div> : null}

        <div className="agent-create-actions">
          <button className="ghost-button" type="button" onClick={handleClose} disabled={saving}>完成</button>
          <button
            className="primary-action-button"
            type="button"
            disabled={!selectedFile || !isDirty || fileLoading || saving}
            onClick={() => void saveSelectedFile()}
          >
            {saving ? "保存中..." : "保存文件"}
          </button>
        </div>
      </section>
    </div>
  );
}
