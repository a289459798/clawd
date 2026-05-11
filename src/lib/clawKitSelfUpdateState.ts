export type ClawKitDownloadedUpdate = {
  version: string;
  mandatory: boolean;
  url: string;
  path: string;
};

export type ClawKitSelfUpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "downloading"; version: string; mandatory: boolean }
  | { status: "ready"; update: ClawKitDownloadedUpdate }
  | { status: "installing"; update: ClawKitDownloadedUpdate };

export function getClawKitSelfUpdateView(state: ClawKitSelfUpdateState) {
  const update = state.status === "ready" || state.status === "installing" ? state.update : null;

  return {
    showOptionalUpdateChrome: Boolean(update),
    mandatoryUpdateOpen: Boolean(update?.mandatory),
    pendingVersion: update?.version ?? (state.status === "downloading" ? state.version : null),
    installingUpdate: state.status === "installing",
  };
}
