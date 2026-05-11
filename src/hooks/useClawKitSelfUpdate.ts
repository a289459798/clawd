import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { getClawKitSelfUpdateView, type ClawKitDownloadedUpdate, type ClawKitSelfUpdateState } from "../lib/clawKitSelfUpdateState";

const CLAWKIT_SELF_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Default manifest when `VITE_CLAWKIT_UPDATE_MANIFEST_URL` is unset (override via `.env` / CI). */
const DEFAULT_UPDATE_MANIFEST_URL = "http://cdn.cugbsh.cn/clawkit/up.json";

const MANIFEST_ENDPOINT =
  (typeof import.meta.env.VITE_CLAWKIT_UPDATE_MANIFEST_URL === "string"
    ? import.meta.env.VITE_CLAWKIT_UPDATE_MANIFEST_URL.trim()
    : "") || DEFAULT_UPDATE_MANIFEST_URL;

type UnsignedProbe = {
  version: string;
  mandatory: boolean;
  url: string;
  /** Same as Tauri package version (`tauri.conf.json`); used for semver compare with manifest. */
  currentVersion: string;
};

export function useClawKitSelfUpdate(enabled: boolean) {
  const [state, setState] = useState<ClawKitSelfUpdateState>({ status: "idle" });

  const busyRef = useRef(false);
  const downloadedKeyRef = useRef<string | null>(null);
  const downloadedUpdateRef = useRef<ClawKitDownloadedUpdate | null>(null);

  const reset = useCallback(() => {
    downloadedKeyRef.current = null;
    downloadedUpdateRef.current = null;
    setState({ status: "idle" });
  }, []);

  const tick = useCallback(async () => {
    if (!enabled || !MANIFEST_ENDPOINT || busyRef.current) {
      return;
    }
    busyRef.current = true;
    setState({ status: "checking" });
    try {
      let probe: UnsignedProbe | null = null;
      try {
        probe = await invoke<UnsignedProbe | null>("clawkit_unsigned_update_probe", {
          endpoint: MANIFEST_ENDPOINT,
        });
      } catch {
        reset();
        return;
      }

      if (!probe) {
        reset();
        return;
      }

      const cacheKey = `${probe.version}:${probe.mandatory ? "m" : "o"}:${probe.url}`;
      if (downloadedKeyRef.current === cacheKey && downloadedUpdateRef.current) {
        setState({ status: "ready", update: downloadedUpdateRef.current });
        return;
      }

      setState({ status: "downloading", version: probe.version, mandatory: probe.mandatory });
      let downloadPath: string;
      try {
        downloadPath = await invoke<string>("clawkit_unsigned_update_download", { url: probe.url });
      } catch {
        reset();
        return;
      }

      downloadedKeyRef.current = cacheKey;
      downloadedUpdateRef.current = {
        version: probe.version,
        mandatory: probe.mandatory,
        url: probe.url,
        path: downloadPath,
      };
      setState({ status: "ready", update: downloadedUpdateRef.current });
    } finally {
      busyRef.current = false;
    }
  }, [enabled, reset]);

  useEffect(() => {
    if (!enabled || !MANIFEST_ENDPOINT) {
      reset();
      return undefined;
    }
    void tick();
    const id = window.setInterval(() => void tick(), CLAWKIT_SELF_UPDATE_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      reset();
    };
  }, [enabled, reset, tick]);

  const applyPendingUpdate = useCallback(async () => {
    const update = downloadedUpdateRef.current;
    const path = update?.path;
    if (!path) {
      return;
    }
    setState({ status: "installing", update });
    try {
      await invoke("clawkit_unsigned_update_install", { path });
    } catch {
      setState({ status: "ready", update });
    }
  }, []);

  const view = getClawKitSelfUpdateView(state);

  return {
    ...view,
    applyPendingUpdate,
  };
}
