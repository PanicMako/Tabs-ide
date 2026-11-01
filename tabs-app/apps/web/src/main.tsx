import React from "react";
import { createRoot } from "react-dom/client";
import { StartupShell } from "./StartupShell";
import { activateStartupSplash, updateStartupSplash } from "./lib/startupSplashLifecycle";
import { handleZoomMenuAction, initializeZoom } from "./state/zoom";
import "./localFonts.css";
import "./index.css";

activateStartupSplash();
initializeZoom();
// Register for every app window, including diagnostics popouts and recovery.
const removeZoomMenuListener = window.desktopBridge?.onMenuAction(handleZoomMenuAction);
if (import.meta.hot) import.meta.hot.dispose(() => removeZoomMenuListener?.());
const rootEl = document.getElementById("root")!;
rootEl.removeAttribute("style");
rootEl.className = "h-dvh w-full overflow-hidden";
const loadApplication = async () => {
  if (new URLSearchParams(window.location.search).get("data-recovery") === "1") {
    const { default: DataRecoveryScreen } =
      await import("./components/settings/DataRecoveryScreen");
    const error = await window.desktopBridge?.getBackendStartupError?.();
    updateStartupSplash({ ready: true });
    return (
      <DataRecoveryScreen error={error ?? "Tabs paused startup to protect your saved data."} />
    );
  }
  const { startup } = await import("./appStartup");
  const app = await startup;
  // Standalone popouts have no workspace hydration gate.
  const { isPopoutMode } = await import("./lib/utils");
  if (isPopoutMode()) updateStartupSplash({ ready: true });
  return app;
};
createRoot(rootEl).render(
  <React.StrictMode>
    <StartupShell loadApplication={loadApplication} />
  </React.StrictMode>,
);
