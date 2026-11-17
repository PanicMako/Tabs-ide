import type { CompanionWorkspace } from "~/stores/companionSurfaceStore";
import { normalizeCompanionUrl } from "./browserSession";

const SEARCH_URL = "https://www.google.com/search?q=";

/** Whether the text is meant as an address rather than a search. */
function looksLikeAddress(input: string): boolean {
  if (/\s/.test(input)) return false;
  if (/^https?:\/\//i.test(input) || input.startsWith("//")) return true;
  if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(?:[/?#]|$)/i.test(input)) return true;
  if (/^[^\s/:?#]+:\d+(?:[/?#]|$)/.test(input)) return true;
  // A dot followed by a plausible top-level label: "example.com", "docs.rs/serde".
  return /^[^\s/?#]+\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(input);
}

/** Turns what someone typed into the omnibox into a page to load. Bare ports open localhost. */
export function resolveOmniboxInput(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("Enter a website, a localhost port or a search.");
  if (/^:?\d{2,5}$/.test(input))
    return normalizeCompanionUrl(`localhost:${input.replace(":", "")}`);
  if (looksLikeAddress(input)) return normalizeCompanionUrl(input);
  return `${SEARCH_URL}${encodeURIComponent(input)}`;
}

/** The quiet form of an address shown while the field is not being edited. */
export function displayAddress(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return value;
    const host = url.host.replace(/^www\./, "");
    const rest = `${url.pathname === "/" ? "" : url.pathname}${url.search}${url.hash}`;
    return `${host}${rest}`;
  } catch {
    return value;
  }
}

export interface RecentPage {
  url: string;
  title: string;
}

/** Pages already open in other browser tabs, newest workspace last, without duplicates. */
export function recentBrowserPages(
  workspaces: Readonly<Record<string, CompanionWorkspace>>,
  excludeId: string,
  limit = 6,
): RecentPage[] {
  const seen = new Set<string>();
  const pages: RecentPage[] = [];
  for (const workspace of Object.values(workspaces).toReversed()) {
    for (const tab of workspace.tabs.toReversed()) {
      if (tab.kind !== "browser" || tab.id === excludeId || !tab.url) continue;
      const key = displayAddress(tab.url);
      if (seen.has(key)) continue;
      seen.add(key);
      pages.push({ url: tab.url, title: tab.title && tab.title !== "Browser" ? tab.title : key });
      if (pages.length === limit) return pages;
    }
  }
  return pages;
}

/** A saved local page must be an address or a port, never a search. */
export function resolveSavedLocalInput(value: string): string {
  const url = resolveOmniboxInput(value);
  if (url.startsWith(SEARCH_URL)) throw new Error("Enter a port such as 5173, or an address.");
  return url;
}
