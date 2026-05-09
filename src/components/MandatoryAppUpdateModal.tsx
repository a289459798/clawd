import { useEffect } from "react";

export function MandatoryAppUpdateModal({
  open,
  version,
  installing,
  onApply,
  t,
}: {
  open: boolean;
  version: string | null;
  installing: boolean;
  onApply: () => void;
  t: (key: string) => string;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const blockEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", blockEscape, true);
    return () => window.removeEventListener("keydown", blockEscape, true);
  }, [open]);

  if (!open) return null;

  return (
    <div className="mandatory-app-update-overlay" role="dialog" aria-modal="true" aria-labelledby="mandatory-app-update-title">
      <div className="mandatory-app-update-card">
        <h2 id="mandatory-app-update-title">{t("appUpdate.mandatory.title")}</h2>
        {version ? (
          <p className="mandatory-app-update-version">
            {t("appUpdate.newVersion")} v{version}
          </p>
        ) : null}
        <p className="mandatory-app-update-body">{t("appUpdate.mandatory.body")}</p>
        <button type="button" className="primary-button mandatory-app-update-cta" onClick={onApply} disabled={installing}>
          {installing ? t("appUpdate.installing") : t("appUpdate.apply")}
        </button>
      </div>
    </div>
  );
}
