import type { NavKey } from "../types/app";

export function GatewayBanner({ connected, statusText, error }: { connected: boolean; statusText: string; error: string | null }) {
  if (connected) return null;
  return (
    <div className="global-gateway-banner" role="alert">
      <div className="global-gateway-banner-main">
        <strong>Gateway 不可用</strong>
        <span>{statusText}</span>
      </div>
      {error ? <code className="global-gateway-banner-error">{error}</code> : null}
    </div>
  );
}

export function ImageLightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
  if (!src) return null;
  return (
    <div className="image-lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <button className="image-lightbox-close" type="button" onClick={onClose}>×</button>
      <img className="image-lightbox-content" src={src} alt="预览大图" onClick={(event) => event.stopPropagation()} />
    </div>
  );
}

export function NavSidebar({ activeNav, onNavChange, onOpenLocalOpenClaw }: {
  activeNav: NavKey;
  onNavChange: (nav: NavKey) => void;
  onOpenLocalOpenClaw: () => void;
}) {
  return (
    <aside className="nav-sidebar">
      <div className="nav-group">
        <button className={`nav-item ${activeNav === "conversations" ? "active" : ""}`} onClick={() => onNavChange("conversations")} type="button">
          对话
        </button>
        <button className={`nav-item ${activeNav === "skills" ? "active" : ""}`} onClick={() => onNavChange("skills")} type="button">
          技能
        </button>
        <button className={`nav-item ${activeNav === "connections" ? "active" : ""}`} onClick={() => onNavChange("connections")} type="button">
          连接
        </button>
      </div>

      <div className="sidebar-bottom-actions">
        <button className="nav-icon-button" onClick={onOpenLocalOpenClaw} title="打开本地 OpenClaw" type="button">
          🌐
        </button>
      </div>
    </aside>
  );
}
