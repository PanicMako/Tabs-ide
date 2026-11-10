import { describe, expect, it } from "vitest";
import { compareTags, fromGitHub, kindOf } from "./changelog";
import { mergeReleases } from "./changelog-curated";

describe("lab changelog", () => {
  it("orders tags by semver, not by string", () => {
    expect(["v1.3.9", "v1.3.34", "v2.0.0"].sort(compareTags)).toEqual(["v2.0.0", "v1.3.34", "v1.3.9"]);
  });

  it("classifies releases by version shape", () => {
    expect(kindOf("v3.0.0")).toBe("major");
    expect(kindOf("v2.4.0")).toBe("feature");
    expect(kindOf("v2.3.1")).toBe("patch");
  });

  it("parses a GitHub release body into headline, summary and bullets", () => {
    const r = fromGitHub({
      tag_name: "v9.9.1",
      published_at: "2026-11-09T09:33:29Z",
      body: "## Brighter workspaces\n\nNew palettes for **every** project.\n\n### What changed\n\n- Pick a `wallpaper`\n- Tune toolbars\n\n### Fixes\n\n- Faster startup",
    });
    expect(r.title).toBe("Brighter workspaces");
    expect(r.summary).toBe("New palettes for every project.");
    expect(r.highlights).toEqual(["Pick a wallpaper", "Tune toolbars"]);
    expect(r.sections).toEqual([{ title: "Fixes", items: ["Faster startup"] }]);
    expect(r.date).toBe("November 9, 2026");
  });

  it("adds releases the curated list has not caught up with, newest first", () => {
    const list = mergeReleases([{ tag_name: "v99.0.1", published_at: "2027-01-01T00:00:00Z", body: "## Hello\n\nHi." }]);
    expect(list[0]!.tag).toBe("v99.0.1");
    expect(list[0]!.title).toBe("Hello");
  });

  it("skips prereleases", () => {
    const list = mergeReleases([{ tag_name: "v99.0.0", published_at: "2027-01-01T00:00:00Z", prerelease: true }]);
    expect(list.some((r) => r.tag === "v99.0.0")).toBe(false);
  });
});

