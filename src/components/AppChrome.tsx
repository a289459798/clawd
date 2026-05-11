import { useEffect, useState } from "react";
import type { NavKey } from "../types/app";

/** Alibaba iconfont Symbol JS injects `#icon-*` defs into the document body. */
function NavSidebarIconfont({ symbolId }: { symbolId: string }) {
  return (
    <svg className="nav-iconfont svgfont" aria-hidden width={22} height={22}>
      <use href={`#${symbolId}`} />
    </svg>
  );
}

function FeedbackNavIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.5h0a8.5 8.5 0 0 1 8.5 8.5z" />
    </svg>
  );
}

import feedbackQrSrc from "../assets/qrcode.png";

export function FeedbackQrDialog({
  open,
  onClose,
  title,
  qrAlt,
  closeLabel,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  qrAlt: string;
  closeLabel: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="feedback-qr-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="feedback-qr-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-qr-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="feedback-qr-dialog-close" type="button" onClick={onClose} aria-label={closeLabel}>
          ×
        </button>
        <h2 id="feedback-qr-dialog-title" className="feedback-qr-dialog-title">
          {title}
        </h2>
        <img className="feedback-qr-dialog-img" src={feedbackQrSrc} alt={qrAlt} loading="lazy" />
      </div>
    </div>
  );
}

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
  clawKitUpdateReady,
  clawKitUpdateInstalling,
  onApplyClawKitUpdate,
}: {
  activeNav: NavKey;
  onNavChange: (nav: NavKey) => void;
  t?: (key: string) => string;
  gatewayConnected?: boolean;
  gatewayVersion?: string | null;
  updateAvailable?: boolean;
  sessionCount?: number;
  onOpenStatus?: () => void;
  clawKitUpdateReady?: boolean;
  clawKitUpdateInstalling?: boolean;
  onApplyClawKitUpdate?: () => void;
}) {
  const translate = t ?? ((key: string) => key);
  const [feedbackQrOpen, setFeedbackQrOpen] = useState(false);
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
            {item.key === "conversations" ? (
              <NavSidebarIconfont symbolId="icon-chat" />
            ) : (
              <span className={`nav-symbol ${item.icon}`} />
            )}
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="sidebar-bottom-actions">
        {clawKitUpdateReady ? (
          <button
            type="button"
            className="clawkit-app-update-sidebar-button"
            title={translate("appUpdate.sidebarTitle")}
            disabled={clawKitUpdateInstalling}
            onClick={() => onApplyClawKitUpdate?.()}
          >
            {translate("appUpdate.sidebarButton")}
          </button>
        ) : null}
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
          className="feedback-nav-button"
          type="button"
          title={translate("nav.feedback")}
          aria-label={translate("nav.feedback")}
          aria-haspopup="dialog"
          aria-expanded={feedbackQrOpen}
          onClick={() => setFeedbackQrOpen(true)}
        >
          <FeedbackNavIcon />
        </button>
        <button
          className={`settings-nav-button ${activeNav === "settings" ? "active" : ""}`}
          type="button"
          title={translate("nav.settings")}
          aria-label={translate("nav.settings")}
          aria-pressed={activeNav === "settings"}
          onClick={() => onNavChange("settings")}
        >
          <NavSidebarIconfont symbolId="icon-setting" />
        </button>
      </div>
      <FeedbackQrDialog
        open={feedbackQrOpen}
        onClose={() => setFeedbackQrOpen(false)}
        title={translate("nav.feedback")}
        qrAlt={translate("feedback.qrAlt")}
        closeLabel={translate("feedback.closeDialog")}
      />
    </aside>
  );
}
