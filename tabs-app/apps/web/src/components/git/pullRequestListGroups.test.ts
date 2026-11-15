import { describe, expect, it } from "vitest";

import { groupPullRequestRows } from "./pullRequestListGroups";

const row = (n: number, author: string | null, viewerReviewRequested?: boolean) => ({
  n,
  author,
  viewerReviewRequested,
});

describe("groupPullRequestRows", () => {
  it("splits yours, review requested and the rest, keeping each group's order", () => {
    const groups = groupPullRequestRows(
      [row(1, "sam"), row(2, "Me"), row(3, "kim", true), row(4, "me"), row(5, null)],
      "me",
    );
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.n)])).toEqual([
      ["authored", [2, 4]],
      ["reviewRequested", [3]],
      ["others", [1, 5]],
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Yours", "Review requested", "Everyone else"]);
  });

  it("does not split when one group holds everything or the viewer is unknown", () => {
    expect(groupPullRequestRows([row(1, "sam"), row(2, "kim")], "me")).toEqual([
      { key: "others", label: "", rows: [row(1, "sam"), row(2, "kim")] },
    ]);
    expect(groupPullRequestRows([row(1, "me")], null)[0]?.label).toBe("");
    expect(groupPullRequestRows([], "me")).toHaveLength(1);
  });
});
