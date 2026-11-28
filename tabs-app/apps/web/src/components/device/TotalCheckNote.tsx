import { TOTAL_CHECK_NONE_TEXT } from "./deviceComparisonShared";

/** A neutral line stating whether this comparison compares totals. */
export function TotalCheckNote({
  check,
  suggest = false,
}: {
  check: "configured" | "none";
  suggest?: boolean;
}) {
  if (check !== "none") return null;
  return (
    <>
      <p className="dv-muted">{TOTAL_CHECK_NONE_TEXT}</p>
      {suggest && (
        <p className="dv-muted">These screens show prices, but totals aren't being compared.</p>
      )}
    </>
  );
}
