import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_CLAWKIT_SETTINGS, mergeClawKitSettings } from "../lib/settingsDefaults";
import type { ClawKitSettings, ClawKitSettingsPatch } from "../types/settings";

type UseClawKitSettingsOptions = {
  enabled?: boolean;
};

type UseClawKitSettingsResult = {
  settings: ClawKitSettings;
  settingsLoading: boolean;
  settingsError: string | null;
  reloadSettings: () => Promise<void>;
  patchSettings: (patch: ClawKitSettingsPatch) => Promise<ClawKitSettings>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isRecord(target) || !isRecord(patch)) return patch;

  const merged: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = key in merged ? mergePatch(merged[key], value) : value;
  }
  return merged;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useClawKitSettings(options: UseClawKitSettingsOptions = {}): UseClawKitSettingsResult {
  const enabled = options.enabled ?? true;
  const [settings, setSettings] = useState<ClawKitSettings>(DEFAULT_CLAWKIT_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const reloadSettings = useCallback(async () => {
    if (!enabled) return;
    setSettingsLoading(true);
    try {
      const raw = await invoke<unknown>("get_clawkit_settings");
      setSettings(mergeClawKitSettings(raw));
      setSettingsError(null);
    } catch (error) {
      setSettingsError(errorMessage(error));
    } finally {
      setSettingsLoading(false);
    }
  }, [enabled]);

  const patchSettings = useCallback(async (patch: ClawKitSettingsPatch) => {
    const previousSettings = settings;
    setSettings(mergeClawKitSettings(mergePatch(settings, patch)));

    try {
      const raw = await invoke<unknown>("patch_clawkit_settings", { patch });
      const reconciled = mergeClawKitSettings(raw);
      setSettings(reconciled);
      setSettingsError(null);
      return reconciled;
    } catch (error) {
      setSettings(previousSettings);
      setSettingsError(errorMessage(error));
      throw error;
    }
  }, [settings]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    setSettingsLoading(true);
    void (async () => {
      try {
        const raw = await invoke<unknown>("get_clawkit_settings");
        if (!cancelled) {
          setSettings(mergeClawKitSettings(raw));
          setSettingsError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setSettingsError(errorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setSettingsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return {
    settings,
    settingsLoading,
    settingsError,
    reloadSettings,
    patchSettings,
  };
}
