import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PullRequestFilterBar } from "./PullRequestFilterBar";

describe("PullRequestFilterBar", () => {
  it("offers involvement and the three review facets, with the active ones selected", () => {
    const html = renderToStaticMarkup(
      <PullRequestFilterBar
        involvement="reviewing"
        onInvolvement={() => undefined}
        filters={{ draft: "hide", checks: "failing" }}
        onFilters={() => undefined}
      />,
    );
    expect(html).toContain("Review requested");
    expect(html).toContain("Mine");
    expect(html).toContain('aria-label="Draft filter"');
    expect(html).toContain('aria-label="Review filter"');
    expect(html).toContain('aria-label="Checks filter"');
    // The active choice is what each facet shows as its current value.
    expect(html).toContain("Hide drafts");
    expect(html).toContain("Failing");
  });
});
