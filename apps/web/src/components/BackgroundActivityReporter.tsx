import { type HostPowerSnapshot } from "@tabs/contracts";
import * as DateTime from "effect/DateTime";
import { useEffect } from "react";

import { ensureNativeApi } from "../nativeApi";
import {
  createActivityReporterQueue,
  getOrCreateClientId,
  LEASE_TTL_MS,
  REPORT_INTERVAL_MS,
  resolveCurrentScopes,
} from "./BackgroundActivityReporter.logic";

export function BackgroundActivityReporter() {
  useEffect(() => {
    const queue = createActivityReporterQueue({
      sendReport: (report) => ensureNativeApi().server.reportClientActivity(report),
      getReportInput: (recentlyInteracted) => ({
        clientId: getOrCreateClientId(sessionStorage),
        clientKind: window.desktopBridge ? "desktop-renderer" : "web",
        visible: document.visibilityState === "visible",
        focused: document.hasFocus(),
        recentlyInteracted,
        appState: document.visibilityState === "visible" ? "active" : "background",
        networkType: navigator.onLine ? "online" : "offline",
        scopes: resolveCurrentScopes(window.location.pathname),
        ttlMs: LEASE_TTL_MS,
        observedAt: DateTime.nowUnsafe(),
      }),
    });

    const handleInteraction = () => queue.recordInteraction();
    const handleVisibilityOrState = () => queue.requestReport(false);

    for (const event of ["pointerdown", "keydown", "focus", "online", "offline"] as const) {
      window.addEventListener(event, handleInteraction, { passive: true });
    }
    document.addEventListener("visibilitychange", handleVisibilityOrState);
    const interval = window.setInterval(() => queue.requestReport(false), REPORT_INTERVAL_MS);

    // Initial immediate report
    queue.requestReport(true);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityOrState);
      for (const event of ["pointerdown", "keydown", "focus", "online", "offline"] as const) {
        window.removeEventListener(event, handleInteraction);
      }
      queue.dispose();
    };
  }, []);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.getHostPowerSnapshot) return;
    const report = (snapshot: HostPowerSnapshot) => {
      void ensureNativeApi()
        .server.reportHostPowerState(snapshot)
        .catch(() => undefined);
    };
    void bridge
      .getHostPowerSnapshot()
      .then(report)
      .catch(() => undefined);
    return bridge.onHostPowerSnapshot?.(report);
  }, []);
  return null;
}
