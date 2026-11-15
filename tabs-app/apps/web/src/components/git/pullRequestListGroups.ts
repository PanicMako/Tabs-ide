/**
 * T3's grouping of a repository's pull requests by how they involve the reader: the ones they
 * wrote, the ones waiting on their review, and everyone else's. Rows stay in the order they
 * arrived inside each group, so a listing's own ranking is kept.
 */
export type PullRequestGroupKey = "authored" | "reviewRequested" | "others";

export interface PullRequestGroup<Row> {
  readonly key: PullRequestGroupKey;
  /** Empty when the list is not split, so the page draws no header. */
  readonly label: string;
  readonly rows: ReadonlyArray<Row>;
}

const LABELS: Record<PullRequestGroupKey, string> = {
  authored: "Yours",
  reviewRequested: "Review requested",
  others: "Everyone else",
};

export function groupPullRequestRows<
  Row extends { author: string | null; viewerReviewRequested?: boolean | undefined },
>(rows: ReadonlyArray<Row>, viewerLogin: string | null): ReadonlyArray<PullRequestGroup<Row>> {
  if (viewerLogin === null || rows.length === 0) {
    return [{ key: "others", label: "", rows }];
  }
  const viewer = viewerLogin.toLowerCase();
  const buckets: Record<PullRequestGroupKey, Row[]> = {
    authored: [],
    reviewRequested: [],
    others: [],
  };
  for (const row of rows) {
    if (row.author?.toLowerCase() === viewer) buckets.authored.push(row);
    else if (row.viewerReviewRequested === true) buckets.reviewRequested.push(row);
    else buckets.others.push(row);
  }
  const present = (Object.keys(buckets) as PullRequestGroupKey[]).filter(
    (key) => buckets[key].length > 0,
  );
  // One group is no grouping: a header over every row says nothing.
  if (present.length <= 1) return [{ key: "others", label: "", rows }];
  return present.map((key) => ({ key, label: LABELS[key], rows: buckets[key] }));
}
