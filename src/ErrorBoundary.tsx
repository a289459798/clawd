import React from "react";
import { createTranslator, resolveLocale } from "./lib/i18n";

const t = createTranslator(resolveLocale("auto", typeof navigator !== "undefined" ? navigator.language : null));

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  error?: string;
};

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error: error?.message || "Unknown error",
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("App render crashed", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="bootstrap-screen">
          <div className="bootstrap-card danger">
            <strong>{t("error.renderFailedTitle")}</strong>
            <p>{t("error.renderFailedDescription")}</p>
            <div className="bootstrap-meta">
              <span>{this.state.error ?? t("error.unknown")}</span>
              <span>{t("error.reportHint")}</span>
            </div>
            <div className="bootstrap-actions">
              <button className="ghost-button" type="button" onClick={() => window.location.reload()}>
                {t("error.reload")}
              </button>
            </div>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
