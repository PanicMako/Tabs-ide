import React from "react";
import ReactDOM from "react-dom/client";
import { createHashHistory, createBrowserHistory } from "@tanstack/react-router";

import "@xterm/xterm/css/xterm.css";
import "@vscode/codicons/dist/codicon.css";
import "./localFonts.css";
import "./index.css";

import { isElectron } from "./env";
import { getRouter } from "./router";
import { APP_DISPLAY_NAME } from "./branding";
import { AppRoot } from "./AppRoot";
import { hasCloudPublicConfig, resolveCloudPublicConfig } from "./cloud/publicConfig";
import { initializeComposerDraftsState } from "./state/composerDrafts";
import { initializeWorkspaceShellState } from "./state/workspaceShell";
import { markStartupStage } from "./lib/startupReadiness";
import { SplashScreen, type SplashScreenProps } from "./components/SplashScreen";

const history = isElectron ? createHashHistory() : createBrowserHistory();
const router = getRouter(history);
document.title = APP_DISPLAY_NAME;

export function readFirstPaintSplashSettings(storage: Pick<Storage, "getItem">): SplashScreenProps {
  try {
    const parsed = JSON.parse(storage.getItem("tabs:client-settings:v1") ?? "null") as Record<
      string,
      unknown
    > | null;
    return {
      loader: parsed?.splashLoaderStyle === "solari" ? "solari" : "glass",
      palette: parsed?.splashLoaderPalette === "block" ? "block" : "mono",
      theme:
        parsed?.splashLoaderTheme === "light" || parsed?.splashLoaderTheme === "dark"
          ? parsed.splashLoaderTheme
          : "system",
    };
  } catch {
    return { loader: "glass", palette: "mono", theme: "system" };
  }
}

const reactRoot = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
reactRoot.render(
  <React.StrictMode>
    <div className="fixed inset-0" role="status" aria-label="Starting Tabs">
      <SplashScreen {...readFirstPaintSplashSettings(window.localStorage)} />
    </div>
  </React.StrictMode>,
);

initializeComposerDraftsState();
initializeWorkspaceShellState();

const publishableKey = resolveCloudPublicConfig().clerkPublishableKey;
const managedAuthShellModule =
  publishableKey && hasCloudPublicConfig()
    ? isElectron
      ? import("./components/auth/ElectronManagedAuthShell")
      : import("./components/auth/BrowserManagedAuthShell")
    : null;

export const startup = Promise.all([
  managedAuthShellModule?.then((module) => module.default) ?? null,
  router.load(),
]).then(([ManagedAuthShell]) => {
  const rootEl = document.getElementById("root");
  if (rootEl) {
    rootEl.removeAttribute("style");
    rootEl.removeAttribute("aria-busy");
    rootEl.className = "h-dvh w-full overflow-hidden";
  }
  const app = <AppRoot router={router} />;
  reactRoot.render(
    <React.StrictMode>
      {ManagedAuthShell && publishableKey ? (
        <ManagedAuthShell publishableKey={publishableKey}>{app}</ManagedAuthShell>
      ) : (
        app
      )}
    </React.StrictMode>,
  );
  // The first callback follows React's initial commit; the second follows a
  // browser paint, so these names reflect observable boundaries rather than
  // module-evaluation time.
  requestAnimationFrame(() => {
    markStartupStage("renderer-hydration");
    requestAnimationFrame(() => markStartupStage("shell-first-paint"));
  });
});
