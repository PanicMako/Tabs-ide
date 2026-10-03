import { describe, expect, it } from "vitest";

import {
  GIT_WORKSPACE_WIDE_BREAKPOINT,
  GIT_WORKSPACE_LAYOUT_SECTIONS,
  getGitWorkspaceLayoutSection,
} from "./GitToolLayout.logic";

describe("Git workspace layout", () => {
  it("keeps the primary workflow focused on overview, composer, changes, and diff", () => {
    expect(
      GIT_WORKSPACE_LAYOUT_SECTIONS.filter((section) => section.column === "primary").map(
        (section) => section.id,
      ),
    ).toEqual(["overview", "composer", "changes", "diff"]);
  });

  it("keeps branch admin and advanced tools in the secondary column", () => {
    expect(
      GIT_WORKSPACE_LAYOUT_SECTIONS.filter(
        (section) => section.column === "secondary" && !section.parentId,
      ).map((section) => section.id),
    ).toEqual(["branches", "advanced-actions", "history"]);
  });

  it("keeps stashes nested under history instead of promoted to a top-level panel", () => {
    expect(getGitWorkspaceLayoutSection("stashes")).toMatchObject({
      column: "secondary",
      parentId: "history",
    });
  });

  it("exposes stable user-facing titles for all visible sections", () => {
    expect(GIT_WORKSPACE_LAYOUT_SECTIONS.map((section) => section.title)).toEqual([
      "Overview",
      "Commit / PR Composer",
      "Changes",
      "Diff Viewer",
      "Branches",
      "Advanced Actions",
      "History",
      "Stashes",
    ]);
  });

  it("collapses to a single column until the extra-wide desktop breakpoint", () => {
    expect(GIT_WORKSPACE_WIDE_BREAKPOINT).toBe("2xl");
  });
});
