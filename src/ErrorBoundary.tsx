import React from "react";

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
            <strong>界面渲染失败</strong>
            <p>ClawKit 遇到了一个前端运行时错误，已经阻止继续黑屏。</p>
            <div className="bootstrap-meta">
              <span>{this.state.error ?? "未知错误"}</span>
              <span>请把控制台错误发出来，我会继续修。</span>
            </div>
            <div className="bootstrap-actions">
              <button className="ghost-button" type="button" onClick={() => window.location.reload()}>
                重新加载
              </button>
            </div>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
