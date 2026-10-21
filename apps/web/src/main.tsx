import React from "react";
import { createRoot } from "react-dom/client";
import { StartupShell } from "./StartupShell";
import { activateStartupSplash, updateStartupSplash } from "./lib/startupSplashLifecycle";
import "./localFonts.css";
import "./index.css";

activateStartupSplash();
const rootEl = document.getElementById("root")!;
rootEl.removeAttribute("style");
rootEl.className = "h-dvh w-full overflow-hidden";
const loadApplication = async () => {
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
