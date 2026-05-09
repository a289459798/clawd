import type { NavKey } from "../types/app";

export function GatewayBanner({
  connected,
  statusText,
  error,
}: {
  connected: boolean;
  statusText: string;
  error: string | null;
}) {
  if (connected) return null;
  return (
    <div className="global-gateway-banner" role="alert">
      <div className="global-gateway-banner-main">
        <strong>Gateway 不可用</strong>
        <span>{statusText}</span>
      </div>
      {error ? (
        <code className="global-gateway-banner-error">{error}</code>
      ) : null}
    </div>
  );
}

export function ImageLightbox({
  src,
  onClose,
}: {
  src: string | null;
  onClose: () => void;
}) {
  if (!src) return null;
  return (
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <button className="image-lightbox-close" type="button" onClick={onClose}>
        ×
      </button>
      <img
        className="image-lightbox-content"
        src={src}
        alt="预览大图"
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}

export function NavSidebar({
  activeNav,
  onNavChange,
  t,
  gatewayConnected,
  gatewayVersion,
  updateAvailable,
  sessionCount,
  onOpenStatus,
}: {
  activeNav: NavKey;
  onNavChange: (nav: NavKey) => void;
  t?: (key: string) => string;
  gatewayConnected?: boolean;
  gatewayVersion?: string | null;
  updateAvailable?: boolean;
  sessionCount?: number;
  onOpenStatus?: () => void;
}) {
  const translate = t ?? ((key: string) => key);
  const navItems: Array<{ key: NavKey; label: string; icon: string }> = [
    { key: "conversations", label: translate("nav.conversations"), icon: "chat" },
    { key: "models", label: translate("nav.models"), icon: "model" },
    { key: "skills", label: translate("nav.skills"), icon: "skill" },
    { key: "connections", label: translate("nav.connections"), icon: "plug" },
    { key: "cron", label: translate("nav.cron"), icon: "cron" },
    { key: "usage", label: translate("nav.usage"), icon: "usage" },
    { key: "pets", label: translate("nav.pets"), icon: "pet" },
  ];
  const openClawTitle = [
    gatewayConnected ? "OpenClaw 已连接" : "OpenClaw 未连接",
    gatewayVersion ? `版本 ${gatewayVersion}` : "",
    updateAvailable ? "有可用更新" : "",
    typeof sessionCount === "number" ? `${sessionCount} 个会话` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <aside className="nav-sidebar">
      <div className="nav-group">
        {navItems.map((item) => (
          <button
            className={`nav-item ${activeNav === item.key ? "active" : ""}`}
            onClick={() => onNavChange(item.key)}
            type="button"
            key={item.key}
          >
            <span className={`nav-symbol ${item.icon}`} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="sidebar-bottom-actions">
        <button
          className={`openclaw-logo-button ${gatewayConnected ? "connected" : "disconnected"}`}
          type="button"
          title={openClawTitle}
          onClick={onOpenStatus}
        >
          <img src="/openclaw-logo-text.svg" alt="OpenClaw" />
          {updateAvailable ? (
            <span className="openclaw-update-badge">有更新</span>
          ) : null}
        </button>
        <button
          className={`settings-nav-button ${activeNav === "settings" ? "active" : ""}`}
          type="button"
          title={translate("nav.settings")}
          aria-label={translate("nav.settings")}
          aria-pressed={activeNav === "settings"}
          onClick={() => onNavChange("settings")}
        >
          <span className="nav-symbol settings" />
        </button>
      </div>
    </aside>
  );
}
