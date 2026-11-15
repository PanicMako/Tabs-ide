import { useEffect } from "react";
import { ensureNativeApi } from "../nativeApi";

export const AUTO_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes threshold
// The server already checks every provider when it boots. This refresh only picks up changes,
// so it waits until the app is idle instead of competing with the first message and first paint.
export const STARTUP_REFRESH_DELAY_MS = 20_000;
export const LAST_MODEL_REFRESH_KEY = "tabs_last_models_refresh_time";

/**
 * Triggers a non-blocking background model discovery refresh across all 5 providers
 * upon application restart, enforced by a minimum 5-minute interval guard.
 */
export function useAutoRefreshModelsOnStartup() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const lastRefresh = Number(localStorage.getItem(LAST_MODEL_REFRESH_KEY) ?? 0);
    const now = Date.now();

    if (now - lastRefresh < AUTO_REFRESH_MIN_INTERVAL_MS) {
      console.log(
        `[ModelDiscovery] Skipping startup auto-refresh (last refresh was ${Math.round(
          (now - lastRefresh) / 1000,
        )}s ago, min interval is 300s)`,
      );
      return;
    }

    // Non-blocking background execution once startup work has settled.
    let idleHandle: number | undefined;
    const run = () => {
      try {
        const api = ensureNativeApi();
        api.server
          .refreshProviders()
          .then(() => {
            localStorage.setItem(LAST_MODEL_REFRESH_KEY, String(Date.now()));
            console.log("[ModelDiscovery] Startup auto-refresh completed successfully");
          })
          .catch((err) => {
            console.warn("[ModelDiscovery] Startup auto-refresh failed:", err);
          });
      } catch (err) {
        console.warn("[ModelDiscovery] Native API error on startup refresh:", err);
      }
    };
    const timer = setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        idleHandle = window.requestIdleCallback(run, { timeout: 10_000 });
      } else {
        run();
      }
    }, STARTUP_REFRESH_DELAY_MS);

    return () => {
      clearTimeout(timer);
      if (idleHandle !== undefined) window.cancelIdleCallback?.(idleHandle);
    };
  }, []);
}
