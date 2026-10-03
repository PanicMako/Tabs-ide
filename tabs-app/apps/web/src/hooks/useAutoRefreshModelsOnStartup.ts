import { useEffect } from "react";
import { ensureNativeApi } from "../nativeApi";

export const AUTO_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes threshold
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

    // Non-blocking background execution after initial render
    const timer = setTimeout(() => {
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
    }, 1500);

    return () => clearTimeout(timer);
  }, []);
}
