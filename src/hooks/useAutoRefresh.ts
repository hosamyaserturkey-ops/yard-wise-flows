import { useCallback, useEffect, useRef } from "react";

/**
 * Calls `load` every `everyMs` while the page is visible, and again on return
 * to the tab or window (but not within `minGapMs` of the last load). The car-lot
 * tables have no live push, so their pages refresh this way.
 * Returns a function to call after each successful load.
 */
export function useAutoRefresh(load: () => void, everyMs = 60_000, minGapMs = 5_000): () => void {
  const lastLoad = useRef(0);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastLoad.current < minGapMs) return;
      load();
    };
    const timer = window.setInterval(refresh, everyMs);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load, everyMs, minGapMs]);
  return useCallback(() => { lastLoad.current = Date.now(); }, []);
}
