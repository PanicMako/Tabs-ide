import type { PullRequestInvolvement, PullRequestListFilters } from "@tabs/contracts";

import { SegmentedControl } from "../ui/segmented-control";
import { Select } from "./gitPrimitives";

type Facet = "draft" | "review" | "checks";

const FACETS: ReadonlyArray<{
  key: Facet;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}> = [
  {
    key: "draft",
    label: "Draft",
    options: [
      { value: "", label: "Any draft state" },
      { value: "only", label: "Drafts only" },
      { value: "hide", label: "Hide drafts" },
    ],
  },
  {
    key: "review",
    label: "Review",
    options: [
      { value: "", label: "Any review" },
      { value: "approved", label: "Approved" },
      { value: "changes-requested", label: "Changes requested" },
      { value: "review-required", label: "Review required" },
      { value: "none", label: "No review" },
    ],
  },
  {
    key: "checks",
    label: "Checks",
    options: [
      { value: "", label: "Any checks" },
      { value: "passing", label: "Passing" },
      { value: "failing", label: "Failing" },
    ],
  },
];

/**
 * Narrows the repository's pull requests by who they involve and by review state. The host reads
 * these as a search, so they ask for exactly the pull requests wanted rather than hiding rows out
 * of one page of an unfiltered list.
 */
export function PullRequestFilterBar({
  involvement,
  onInvolvement,
  filters,
  onFilters,
}: {
  involvement: PullRequestInvolvement;
  onInvolvement: (next: PullRequestInvolvement) => void;
  filters: PullRequestListFilters;
  onFilters: (next: PullRequestListFilters) => void;
}) {
  const setFacet = (key: Facet, value: string) => {
    const { [key]: _removed, ...rest } = filters;
    onFilters(value === "" ? rest : ({ ...rest, [key]: value } as PullRequestListFilters));
  };
  return (
    <>
      <SegmentedControl
        size="sm"
        aria-label="Pull request involvement"
        value={involvement}
        onValueChange={onInvolvement}
        options={[
          { value: "all", label: "Everyone" },
          { value: "authored", label: "Mine" },
          { value: "reviewing", label: "Review requested" },
        ]}
      />
      {FACETS.map((facet) => (
        <Select
          key={facet.key}
          aria-label={`${facet.label} filter`}
          value={filters[facet.key] ?? ""}
          onChange={(event) => setFacet(facet.key, event.target.value)}
          className="h-8 rounded-md border border-border/60 bg-background px-2 text-xs text-foreground/90 outline-none"
        >
          {facet.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      ))}
    </>
  );
}
