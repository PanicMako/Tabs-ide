import {
  DEFAULT_BROWSER_LINK_TARGET,
  effectiveBrowserLinkTarget,
  type BrowserLinkTarget,
} from "@tabs/contracts/settings";
import { readNativeApi } from "./nativeApi";
import { appAtomRegistry } from "./state/atomRegistry";
import { clientSettingsAtom } from "./state/settings";

/**
 * One place that decides where a clicked link goes.
 *
 * "app" opens the link in a Scratch Browser tab inside Tabs; "system" hands it
 * to the OS default browser. The in-app side is provided by whichever surface
 * can actually show a Scratch Browser right now (the workspace shell registers
 * itself as the host), so popout windows, Settings and project-less screens
 * fall back to the system browser on their own.
 */

export function isWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function resolveBrowserLinkTarget(input: {
  url: string;
  preference: BrowserLinkTarget;
  /** Whether a surface that can show an in-app browser is mounted. */
  canOpenInApp: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): BrowserLinkTarget {
  // A modifier click is the escape hatch to the system browser.
  if (input.metaKey || input.ctrlKey) return "system";
  if (input.preference !== "app" || !input.canOpenInApp || !isWebUrl(input.url)) return "system";
  return "app";
}

/** Returns true when it opened the link; false lets the caller fall back. */
export type InAppLinkHost = (url: string) => boolean;

let inAppLinkHost: InAppLinkHost | null = null;

export function registerInAppLinkHost(host: InAppLinkHost): () => void {
  inAppLinkHost = host;
  return () => {
    if (inAppLinkHost === host) inAppLinkHost = null;
  };
}

export function readBrowserLinkPreference(): BrowserLinkTarget {
  try {
    return effectiveBrowserLinkTarget(appAtomRegistry.get(clientSettingsAtom));
  } catch {
    return DEFAULT_BROWSER_LINK_TARGET;
  }
}

export async function openInSystemBrowser(url: string): Promise<void> {
  const api = readNativeApi();
  if (api) {
    await api.shell.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Open a link the user clicked, honouring the "Open links in" setting.
 * `force` skips the preference for actions that are explicitly about the
 * other destination (for example "Open in system browser").
 */
export async function openLink(
  url: string,
  options: {
    metaKey?: boolean;
    ctrlKey?: boolean;
    force?: BrowserLinkTarget;
  } = {},
): Promise<BrowserLinkTarget> {
  const host = inAppLinkHost;
  const target =
    options.force ??
    resolveBrowserLinkTarget({
      url,
      preference: readBrowserLinkPreference(),
      canOpenInApp: host !== null,
      metaKey: options.metaKey ?? false,
      ctrlKey: options.ctrlKey ?? false,
    });
  if (target === "app" && host && isWebUrl(url) && host(url)) return "app";
  await openInSystemBrowser(url);
  return "system";
}

/** Fire-and-forget variant for click handlers; failures surface in the console. */
export function openLinkFromEvent(
  url: string,
  event?: { metaKey?: boolean; ctrlKey?: boolean } | null,
): void {
  void openLink(url, {
    metaKey: event?.metaKey ?? false,
    ctrlKey: event?.ctrlKey ?? false,
  }).catch((error: unknown) => console.error("Could not open link", error));
}

/** Anchors (or their ancestors) can opt out with `data-link-target="system"`. */
export const LINK_TARGET_ATTRIBUTE = "data-link-target";

/**
 * Decide whether a document-level click on an anchor should be routed through
 * `openLink`. Only plain left clicks on web links that would leave the app
 * (new window or another origin) qualify; anything a component already
 * handled (`defaultPrevented`) is left alone.
 */
export function anchorLinkForClick(event: MouseEvent, origin: string): string | null {
  if (event.defaultPrevented || event.button !== 0 || event.altKey || event.shiftKey) return null;
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.hasAttribute("download")) return null;
  if (anchor.closest(`[${LINK_TARGET_ATTRIBUTE}="system"]`)) return null;
  const href = anchor.href;
  if (!isWebUrl(href)) return null;
  const leavesApp = anchor.target === "_blank" || new URL(href).origin !== origin;
  return leavesApp ? href : null;
}

/**
 * Route every outbound web link in the document through `openLink`. Installed
 * once at app startup; listens in the bubble phase so component handlers run
 * first and can claim a click with `preventDefault()`.
 */
export function installLinkInterceptor(doc: Document = document): () => void {
  const onClick = (event: MouseEvent) => {
    const href = anchorLinkForClick(event, doc.location.origin);
    if (!href) return;
    event.preventDefault();
    openLinkFromEvent(href, event);
  };
  doc.addEventListener("click", onClick);
  return () => doc.removeEventListener("click", onClick);
}
