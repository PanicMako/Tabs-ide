import { changelogData, type ChangelogRelease } from "../../data/changelogData";
import { mergeInto, type GitHubLikeRelease, type LabRelease } from "./changelog";

const RELEASES = "https://github.com/PanicMako/Tabs-ide/releases/tag/";

function fromCurated(c: ChangelogRelease): LabRelease {
  return {
    tag: c.tag,
    title: c.title,
    iso: new Date(`${c.date} 12:00 UTC`).toISOString(),
    date: c.date,
    kind: c.type,
    summary: c.summary,
    highlights: c.highlights,
    // Older entries repeat their highlights as the only category; don't show them twice.
    sections: c.categories.filter((s) => !(s.items.length === c.highlights.length && s.items.every((i, k) => i === c.highlights[k]))),
    url: `${RELEASES}${c.tag}`,
  };
}

/** Curated notes win; GitHub fills in any release the curated list hasn't caught up with. Server-side only. */
export function mergeReleases(github: GitHubLikeRelease[]): LabRelease[] {
  return mergeInto(changelogData.map(fromCurated), github);
}
