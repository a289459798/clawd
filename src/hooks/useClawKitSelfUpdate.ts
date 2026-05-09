import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

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
};

export function useClawKitSelfUpdate(enabled: boolean) {
  const [ready, setReady] = useState<{ version: string; mandatory: boolean } | null>(null);
  const [installing, setInstalling] = useState(false);

  const busyRef = useRef(false);
  const downloadedKeyRef = useRef<string | null>(null);
  const pendingPathRef = useRef<string | null>(null);
  const pendingUrlRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    downloadedKeyRef.current = null;
    pendingPathRef.current = null;
    pendingUrlRef.current = null;
    setReady(null);
    setInstalling(false);
  }, []);

  const tick = useCallback(async () => {
    if (!enabled || !MANIFEST_ENDPOINT || busyRef.current) {
      return;
    }
    busyRef.current = true;
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

      const cacheKey = `${probe.version}:${probe.mandatory ? "m" : "o"}`;
      if (downloadedKeyRef.current === cacheKey && pendingPathRef.current) {
        setReady({ version: probe.version, mandatory: probe.mandatory });
        return;
      }

      let downloadPath: string;
      try {
        downloadPath = await invoke<string>("clawkit_unsigned_update_download", { url: probe.url });
      } catch {
        reset();
        return;
      }

      downloadedKeyRef.current = cacheKey;
      pendingPathRef.current = downloadPath;
      pendingUrlRef.current = probe.url;
      setReady({ version: probe.version, mandatory: probe.mandatory });
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
    const path = pendingPathRef.current;
    if (!path) {
      return;
    }
    setInstalling(true);
    try {
      await invoke("clawkit_unsigned_update_install", { path });
    } catch {
      setInstalling(false);
    }
  }, []);

  return {
    showOptionalUpdateChrome: Boolean(ready),
    mandatoryUpdateOpen: Boolean(ready?.mandatory),
    pendingVersion: ready?.version ?? null,
    installingUpdate: installing,
    applyPendingUpdate,
  };
}
