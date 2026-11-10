/**
 * Page transitions between the new-design pages: the loader covers the screen,
 * the browser navigates, and the next page's loader opens back up.
 */
const PAGES = new Set(["/", "/changelog", "/downloads"]);
let cover: (() => Promise<void>) | null = null;
let leaving = false;

export function setCover(fn: () => Promise<void>) {
  cover = fn;
  if ((window as unknown as { __tabsTransitions?: boolean }).__tabsTransitions) return;
  (window as unknown as { __tabsTransitions?: boolean }).__tabsTransitions = true;
  document.addEventListener("click", onClick);
  // Coming back with the back button restores a covered page from the cache; reload it fresh.
  window.addEventListener("pageshow", (e) => { if (e.persisted && leaving) location.reload(); });
}

const normal = (p: string) => (p.length > 1 ? p.replace(/\/$/, "") : p);

function onClick(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
  if (!a || a.target === "_blank" || a.hasAttribute("download") || !cover) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const url = new URL(a.href, location.href);

  // Installer downloads: a short cover-and-open flourish while the file starts.
  if (/github\.com\/[^/]+\/[^/]+\/releases\/download\//.test(url.href)) {
    cover().then(() => window.dispatchEvent(new Event("tabs:reveal")));
    return;
  }
  if (url.origin !== location.origin) return;
  const to = normal(url.pathname), here = normal(location.pathname);
  if (to === here || !PAGES.has(to)) return;
  e.preventDefault();
  leaving = true;
  try { sessionStorage.setItem("tabs-transition", "1"); } catch {}
  cover().then(() => { location.href = url.href; });
}
