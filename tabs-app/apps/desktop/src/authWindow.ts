/**
 * Hardened shared-partition authentication windows.
 *
 * Provides a dedicated, secure BrowserWindow that shares the exact session
 * partition with the originating preview session. Enforces context isolation,
 * sandboxing, node isolation, real origin visibility, nested popup depth limits,
 * abandoned flow timeouts, safe "Open in Default Browser" action, and cookie flushing.
 */

import { BrowserWindow, Menu, shell, session as electronSession, type Session } from "electron";
import { sanitizeAuthUrl, hasSameRegistrableOrigin } from "./authClassifier";

export interface OpenAuthWindowOptions {
  readonly partition: string;
  readonly targetUrl: string;
  readonly label: string;
  readonly completionOriginUrl?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly onCompleted?: (() => void) | undefined;
  readonly onCancelled?: (() => void) | undefined;
}

export interface AuthWindowResult {
  readonly completed: boolean;
  readonly finalUrl: string | null;
  readonly origin: string | null;
  readonly durationMs: number;
}

const DEFAULT_AUTH_WINDOW_TIMEOUT_MS = 600_000; // 10 minutes

export function isCompletionReturn(candidateUrl: string, completionOriginUrl?: string): boolean {
  if (!completionOriginUrl) return false;
  try {
    const candidate = new URL(candidateUrl);
    new URL(completionOriginUrl);
    if (candidate.protocol !== "https:" && candidate.protocol !== "http:") return false;
    const sameOrigin = hasSameRegistrableOrigin(candidateUrl, completionOriginUrl);
    if (!sameOrigin) return false;

    // Must not still be on an IdP or auth path
    const path = candidate.pathname.toLowerCase();
    const isAuthPath =
      path.includes("/oauth") ||
      path.includes("/signin") ||
      path.includes("/authorize") ||
      path === "/login";
    return !isAuthPath;
  } catch {
    return false;
  }
}

export async function openHardenedAuthWindow(
  options: OpenAuthWindowOptions,
): Promise<AuthWindowResult> {
  const startedAt = Date.now();
  const session: Session = electronSession.fromPartition(options.partition);
  const timeoutMs = options.timeoutMs ?? DEFAULT_AUTH_WINDOW_TIMEOUT_MS;

  const win = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 400,
    minHeight: 500,
    title: `Sign In · ${options.label}`,
    autoHideMenuBar: false,
    show: true,
    webPreferences: {
      partition: options.partition,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  const menu = Menu.buildFromTemplate([
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Open in Default Browser",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            if (win.isDestroyed()) return;
            const current = win.webContents.getURL();
            if (current && (current.startsWith("https:") || current.startsWith("http:"))) {
              void shell.openExternal(current);
            }
          },
        },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
      ],
    },
  ]);
  win.setMenu(menu);

  const updateTitleWithOrigin = (url: string) => {
    try {
      const parsed = new URL(url);
      win.setTitle(`${parsed.origin} · Sign In · ${options.label}`);
    } catch {
      win.setTitle(`Sign In · ${options.label}`);
    }
  };

  updateTitleWithOrigin(options.targetUrl);

  let completed = false;
  let finalUrl: string | null = null;
  let finalOrigin: string | null = null;

  const checkCompletion = (navigatedUrl: string) => {
    if (completed || !options.completionOriginUrl) return;
    if (isCompletionReturn(navigatedUrl, options.completionOriginUrl)) {
      completed = true;
      finalUrl = sanitizeAuthUrl(navigatedUrl);
      try {
        finalOrigin = new URL(navigatedUrl).origin;
      } catch {}
      void session.cookies
        .flushStore()
        .catch(() => {})
        .finally(() => {
          if (!win.isDestroyed()) {
            win.close();
          }
        });
    }
  };

  win.webContents.on("did-navigate", (_event, url) => {
    updateTitleWithOrigin(url);
    checkCompletion(url);
  });

  win.webContents.on("did-navigate-in-page", (_event, url) => {
    updateTitleWithOrigin(url);
    checkCompletion(url);
  });

  // Block unsupported protocols from entering the window
  win.webContents.on("will-navigate", (event, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });

  // Safe user cancellation via Escape
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "Escape") {
      event.preventDefault();
      if (!win.isDestroyed()) {
        win.close();
      }
    }
  });

  // Limit nested popup chains to a single depth and inherit hardened preferences
  win.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
    try {
      const parsed = new URL(popupUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { action: "deny" };
      }
    } catch {
      return { action: "deny" };
    }

    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        webPreferences: {
          partition: options.partition,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webSecurity: true,
          allowRunningInsecureContent: false,
        },
      },
    };
  });

  win.webContents.on("did-create-window", (childWindow) => {
    // Child popup must not open grandchildren popups
    childWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
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
  });

  let timeoutTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timeoutTimer = null;
    if (!win.isDestroyed()) {
      win.close();
    }
  }, timeoutMs);

  try {
    await win.loadURL(options.targetUrl);
  } catch {
    // In case navigation fails early (e.g. offline)
  }

  await new Promise<void>((resolve) => {
    if (win.isDestroyed()) {
      resolve();
      return;
    }
    win.once("closed", resolve);
  });

  if (timeoutTimer) {
    clearTimeout(timeoutTimer);
    timeoutTimer = null;
  }

  await session.cookies.flushStore().catch(() => {});

  if (completed) {
    options.onCompleted?.();
  } else {
    options.onCancelled?.();
  }

  return {
    completed,
    finalUrl,
    origin: finalOrigin,
    durationMs: Date.now() - startedAt,
  };
}
