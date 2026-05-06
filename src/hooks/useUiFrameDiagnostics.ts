import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendSlowFrameEntry,
  type UiSlowFrameEntry,
  type UiSlowFrameKind,
} from "../lib/uiFrameDiagnostics";

const MAX_ENTRIES = 40;

export interface UiFrameDiagnosticsCapabilities {
  longAnimationFrame: boolean;
  longTask: boolean;
}

export function useUiFrameDiagnostics(enabled: boolean) {
  const [entries, setEntries] = useState<UiSlowFrameEntry[]>([]);
  const [capabilities, setCapabilities] = useState<UiFrameDiagnosticsCapabilities>({
    longAnimationFrame: false,
    longTask: false,
  });
  const seqRef = useRef(0);

  const clear = useCallback(() => setEntries([]), []);

  useEffect(() => {
    if (!enabled || typeof PerformanceObserver === "undefined") {
      return;
    }

    const observers: PerformanceObserver[] = [];
    let loafOk = false;
    let longTaskOk = false;

    const push = (kind: UiSlowFrameKind, duration: number, detail?: string) => {
      const id = `${kind}-${performance.now()}-${seqRef.current++}`;
      setEntries((prev) =>
        appendSlowFrameEntry(
          prev,
          {
            id,
            ts: Date.now(),
            durationMs: duration,
            kind,
            detail: detail?.trim() ? detail.trim() : undefined,
          },
          MAX_ENTRIES,
        ),
      );
    };

    try {
      const loafObs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          push("long-animation-frame", e.duration);
        }
      });
      loafObs.observe({ type: "long-animation-frame", buffered: true });
      observers.push(loafObs);
      loafOk = true;
    } catch {
      // Unsupported (e.g. some WebKit builds).
    }

    try {
      const ltObs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          const name = "name" in e && typeof e.name === "string" ? e.name : undefined;
          push("longtask", e.duration, name);
        }
      });
      ltObs.observe({ type: "longtask", buffered: true });
      observers.push(ltObs);
      longTaskOk = true;
    } catch {
      try {
        const ltObsLegacy = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            const name = "name" in e && typeof e.name === "string" ? e.name : undefined;
            push("longtask", e.duration, name);
          }
        });
        ltObsLegacy.observe({ entryTypes: ["longtask"], buffered: true } as PerformanceObserverInit);
        observers.push(ltObsLegacy);
        longTaskOk = true;
      } catch {
        // Unsupported.
      }
    }

    setCapabilities({ longAnimationFrame: loafOk, longTask: longTaskOk });

    return () => {
      observers.forEach((o) => {
        try {
          o.disconnect();
        } catch {
          /* noop */
        }
      });
    };
  }, [enabled]);

  return { entries, clear, capabilities };
}
