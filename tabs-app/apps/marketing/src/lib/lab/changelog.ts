export type ReleaseKind = "major" | "feature" | "patch";

export interface LabRelease {
  tag: string;
  title: string;
  iso: string;
  date: string;
  kind: ReleaseKind;
  summary: string;
  highlights: string[];
  sections: { title: string; items: string[] }[];
  url: string;
}

export interface GitHubLikeRelease {
  tag_name: string;
  name?: string;
  published_at: string;
  body?: string | null;
  html_url?: string;
  prerelease?: boolean;
}

const RELEASES = "https://github.com/PanicMako/Tabs-ide/releases/tag/";

export const semver = (tag: string) => tag.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
export const compareTags = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i]! - x[i]!;
  return 0;
};
export const kindOf = (tag: string): ReleaseKind => {
  const [, minor, patch] = semver(tag);
  return minor === 0 && patch === 0 ? "major" : patch === 0 ? "feature" : "patch";
};
export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Turn a GitHub release body (Markdown) into a headline, summary and bullet sections. */
export function fromGitHub(r: GitHubLikeRelease): LabRelease {
  const body = (r.body ?? "").replace(/\r/g, "");
  const lines = body.split("\n");
  const h2 = lines.find((l) => /^##\s+/.test(l))?.replace(/^##\s+/, "").trim();
  const summary =
    lines.find((l) => l.trim() && !/^#|^[-*]\s|^\*\*Full Changelog/.test(l.trim()))?.trim() ??
    "Release notes are on GitHub.";
  const sections: LabRelease["sections"] = [];
  let current: LabRelease["sections"][number] | null = null;
  for (const l of lines) {
    const h = l.match(/^###\s+(.*)/);
    if (h) {
      current = { title: h[1]!.trim(), items: [] };
      sections.push(current);
      continue;
    }
    const b = l.match(/^\s*[-*]\s+(.*)/);
    if (b) {
      if (!current) {
        current = { title: "What changed", items: [] };
        sections.push(current);
      }
      current.items.push(b[1]!.replace(/\*\*(.*?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").trim());
    }
  }
  const cleaned = sections.filter((s) => s.items.length);
  return {
    tag: r.tag_name.startsWith("v") ? r.tag_name : `v${r.tag_name}`,
    title: h2 || r.name?.replace(/^Tabs\s+/i, "") || r.tag_name,
    iso: r.published_at,
    date: formatDate(r.published_at),
    kind: kindOf(r.tag_name),
    summary: summary.replace(/\*\*(.*?)\*\*/g, "$1"),
    highlights: cleaned[0]?.items.slice(0, 6) ?? [],
    sections: cleaned.slice(1),
    url: r.html_url ?? `${RELEASES}${r.tag_name}`,
  };
}

/** Add GitHub releases to an existing list. Existing notes win; GitHub fills gaps and exact dates. */
export function mergeInto(base: LabRelease[], github: GitHubLikeRelease[]): LabRelease[] {
  const byTag = new Map(base.map((r) => [r.tag, r] as const));
  for (const g of github) {
    if (g.prerelease) continue;
    const r = fromGitHub(g);
    const known = byTag.get(r.tag);
    byTag.set(r.tag, known ? { ...known, iso: r.iso, date: r.date } : r);
  }
  return [...byTag.values()].sort((a, b) => compareTags(a.tag, b.tag));
}


/** Latest releases from the site's API (or GitHub), merged into `base`. Null when offline. */
export async function liveReleases(base: LabRelease[]): Promise<LabRelease[] | null> {
  const sources: Array<() => Promise<GitHubLikeRelease[] | undefined>> = [
    async () => { const r = await fetch("/api/releases?per_page=10", { signal: AbortSignal.timeout(4000) }); return r.ok ? r.json() : undefined; },
    async () => { const r = await fetch("https://api.github.com/repos/PanicMako/Tabs-ide/releases?per_page=10", { signal: AbortSignal.timeout(5000), headers: { Accept: "application/vnd.github+json" } }); return r.ok ? r.json() : undefined; },
  ];
  for (const s of sources) {
    try {
      const data = await s();
      if (Array.isArray(data) && data.length) return mergeInto(base, data);
    } catch { /* next source */ }
  }
  return null;
}
