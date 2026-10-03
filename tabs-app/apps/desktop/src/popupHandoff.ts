/**
 * Secure OAuth Popup & Opener Handoff.
 *
 * Implements safe, reliable popup management for federated login flows
 * (Google Identity Services, GitHub, Clerk, Auth0, Supabase) that require
 * native `window.opener` and postMessage handoff without compromising security.
 */

import { type BrowserWindow, type HandlerDetails, type WebContents, shell } from "electron";
import { classifyAuthNavigation } from "./authClassifier";

export type WindowOpenDecision =
  | {
      readonly action: "allow";
      readonly overrideBrowserWindowOptions: Electron.BrowserWindowConstructorOptions;
    }
  | {
      readonly action: "deny";
      readonly handledExternally?: boolean | undefined;
      readonly handledInTab?: boolean | undefined;
      readonly externalOAuthRequired?: boolean | undefined;
    };

const POPUP_ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export function isSafePopupProtocol(rawUrl: string): boolean {
  if (rawUrl === "about:blank" || rawUrl === "") return true;
  try {
    const parsed = new URL(rawUrl);
    return POPUP_ALLOWED_PROTOCOLS.has(parsed.protocol.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Decides whether a window.open request from a WebContentsView should open
 * as a native popup window (retaining window.opener and profile partition) or stay in-tab.
 */
export function decideWindowOpenAction(
  details: HandlerDetails,
  parentPartition: string,
  initiatingUrl?: string | null,
): WindowOpenDecision {
  const rawUrl = (details.url ?? "").trim();

  // Deny unsafe or privileged schemes immediately (e.g. javascript:, file:, chrome:)
  if (!isSafePopupProtocol(rawUrl)) {
    return { action: "deny" };
  }

  const classification = classifyAuthNavigation({
    url: rawUrl,
    initiatingUrl,
    disposition: details.disposition,
    isWindowOpen: details.disposition === "new-window",
  });

  // Scripted popups with disposition "new-window" (e.g. window.open("", "auth") or OAuth popups)
  if (details.disposition === "new-window") {
    if (classification.kind === "externalOAuthRequired") {
      return { action: "deny", externalOAuthRequired: true };
    }

    // Allow legitimate web/about:blank popups to retain native window.opener and postMessage handoff
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        width: 800,
        height: 700,
        minWidth: 360,
        minHeight: 400,
        autoHideMenuBar: true,
        webPreferences: {
          partition: parentPartition,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webSecurity: true,
          allowRunningInsecureContent: false,
        },
      },
    };
  }

  // Plain target=_blank links (disposition foreground-tab / background-tab)
  // stay inside the embedded browser tab to preserve user profile and login state.
  return { action: "deny", handledInTab: true };
}

/**
 * Hardens a child popup window created by Electron's native window open handler.
 */
export function configureChildPopupWindow(
  childWindow: BrowserWindow,
  parentContents: WebContents,
  _partition: string,
): void {
  childWindow.setMenuBarVisibility(false);

  // Prevent popup chains: grandchild popups are denied
  childWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Deny navigation to unsupported or local privileged schemes
  childWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });

  // Update title to display current origin transparently
  childWindow.webContents.on("did-navigate", (_event, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        childWindow.setTitle(`${parsed.origin} · Sign In · Tabs`);
      }
    } catch {}
  });

  // Handle child window close: restore focus to parent view
  childWindow.once("closed", () => {
    if (!parentContents.isDestroyed()) {
      parentContents.focus();
    }
  });
}
