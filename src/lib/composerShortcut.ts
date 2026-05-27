import type { SendShortcut } from "../types/settings";

type ComposerKeyEvent = {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
};

export function shouldSubmitComposer(shortcut: SendShortcut, event: ComposerKeyEvent) {
  if (event.key !== "Enter" || event.shiftKey) return false;
  if (shortcut === "enterToSend") return !event.metaKey && !event.ctrlKey;
  return event.metaKey || event.ctrlKey;
}
