import { pickAsset, selectDownloadRelease, platforms, detectPlatform, type Release, type Platform } from "../releases";

/**
 * Shared client behaviour for every downloads concept.
 * Markup contract: `[data-build="<platform>"]` links (with a `[data-file]` child),
 * `[data-version]`, `[data-date]`, optional `[data-live]` and `[data-release-link]`.
 * A click on a build dispatches `tabs:download` on `document` with `{ id, fam, el }`.
 */
export type Fam = "mac" | "win" | "linux";
export const famOf = (id: Platform): Fam => (id.startsWith("mac") ? "mac" : id.startsWith("win") ? "win" : "linux");

export function detect() {
  const ua = navigator.userAgent;
  const isMobile = /Android|iPhone|iPad|Mobile/i.test(ua);
  const isMac = /Macintosh|Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua);
  const p = isMac ? null : detectPlatform(ua);
  const fam: Fam | null = isMac ? "mac" : p ? famOf(p) : null;
  return { fam, isMobile, platform: p };
}

export function initDownloads() {
  document.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLAnchorElement>("[data-build]");
    if (!el) return;
    const id = el.dataset.build as Platform;
    document.dispatchEvent(new CustomEvent("tabs:download", { detail: { id, fam: famOf(id), el } }));
  });

  (async () => {
    const sources = [
      () => fetch("/api/releases?per_page=5", { signal: AbortSignal.timeout(4000) }),
      () => fetch("https://api.github.com/repos/PanicMako/Tabs-ide/releases?per_page=5", { signal: AbortSignal.timeout(5000), headers: { Accept: "application/vnd.github+json" } }),
    ];
    for (const s of sources) {
      try {
        const r = await s();
        if (!r.ok) continue;
        const rel = selectDownloadRelease((await r.json()) as Release[]);
        if (!rel) continue;
        const v = rel.tag_name.replace(/^v/, "");
        document.querySelectorAll<HTMLAnchorElement>("[data-build]").forEach((a) => {
          const id = a.dataset.build as Platform;
          const href = pickAsset(rel, id);
          if (href) a.href = href;
          const name = `Tabs-${v}${platforms.find((p) => p.id === id)!.suffix}`;
          a.dataset.fileName = name;
          a.querySelectorAll("[data-file]").forEach((f) => (f.textContent = name));
        });
        document.querySelectorAll("[data-version]").forEach((e) => (e.textContent = rel.tag_name));
        const date = new Date(rel.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
        document.querySelectorAll("[data-date]").forEach((e) => (e.textContent = date));
        document.querySelectorAll<HTMLAnchorElement>("[data-release-link]").forEach((a) => (a.href = rel.html_url));
        document.querySelectorAll("[data-live]").forEach((e) => { e.classList.add("ok"); e.querySelector("[data-live-text]")!.textContent = `Live from GitHub · ${rel.tag_name}`; });
        document.dispatchEvent(new CustomEvent("tabs:release", { detail: rel }));
        return;
      } catch { /* next source */ }
    }
  })();
}
