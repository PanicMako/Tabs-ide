import { CommandId, MessageId, ProjectId, ThreadId } from "@tabs/contracts";
import { type CxOptions, cx } from "class-variance-authority";
import { twMerge } from "tailwind-merge";
import * as Random from "effect/Random";
import * as Effect from "effect/Effect";

export function cn(...inputs: CxOptions) {
  return twMerge(cx(inputs));
}

export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function isWindowsPlatform(platform: string): boolean {
  return /^win(dows)?/i.test(platform);
}

export function isLinuxPlatform(platform: string): boolean {
  return /linux/i.test(platform);
}

export function randomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const newCommandId = (): CommandId => CommandId.makeUnsafe(randomUUID());

export const newProjectId = (): ProjectId => ProjectId.makeUnsafe(randomUUID());

export const newThreadId = (): ThreadId => ThreadId.makeUnsafe(randomUUID());

export const newMessageId = (): MessageId => MessageId.makeUnsafe(randomUUID());

/**
 * Returns URLSearchParams extracted from the current page URL in a way that
 * works for both routing strategies:
 *
 * - **Browser history** (dev mode / web): params live in `window.location.search`
 *   e.g. `http://localhost:5173/settings?popout=true`
 *
 * - **Hash history** (Electron production): TanStack Router embeds the full
 *   path *and* search string inside the hash fragment, so `window.location.search`
 *   is empty while the actual params are inside `window.location.hash`
 *   e.g. `tabs://app/index.html#/settings?popout=true`
 *
 * Always prefer this over `new URLSearchParams(window.location.search)` when
 * reading route-level query params.
 */
export function getHashAwareSearchParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash;
  const qIdx = hash.indexOf("?");
  if (qIdx !== -1) {
    const hashParams = new URLSearchParams(hash.slice(qIdx));
    for (const [key, value] of hashParams.entries()) {
      if (!params.has(key)) {
        params.set(key, value);
      }
    }
  }
  return params;
}

/**
 * Returns true when the window is operating as a dedicated popout window.
 * Checked via immutable desktopBridge flags, injected globals, or URL query parameters.
 */
export function isPopoutMode(): boolean {
  if (typeof window === "undefined") return false;
  if ((window as unknown as { __TABS_IS_POPOUT__?: boolean }).__TABS_IS_POPOUT__) return true;
  if (window.desktopBridge?.isPopout) return true;
  return getHashAwareSearchParams().get("popout") === "true";
}
