import React from "react";
import { createHashHistory, createBrowserHistory } from "@tanstack/react-router";

import "@xterm/xterm/css/xterm.css";
import "@vscode/codicons/dist/codicon.css";

import { isElectron } from "./env";
import { getRouter } from "./router";
import { APP_DISPLAY_NAME } from "./branding";
import { AppRoot } from "./AppRoot";
import { hasCloudPublicConfig, resolveCloudPublicConfig } from "./cloud/publicConfig";
import { initializeComposerDraftsState } from "./state/composerDrafts";
import { initializeWorkspaceShellState } from "./state/workspaceShell";

const history = isElectron ? createHashHistory() : createBrowserHistory();
const router = getRouter(history);
document.title = APP_DISPLAY_NAME;

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
  return ManagedAuthShell && publishableKey ? (
    <ManagedAuthShell publishableKey={publishableKey}>{app}</ManagedAuthShell>
  ) : (
    app
  );
});
