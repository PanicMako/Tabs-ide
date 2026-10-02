import { reviewOperationsDetail } from "../lib/reviewOperations";

const content = document.getElementById("review-operations-details")!;
const advisory = document.getElementById("review-operations-advisory")!;
const lists = {
  activity: document.getElementById("review-operations-activity")!,
  metadata: document.getElementById("review-operations-metadata")!,
  alerts: document.getElementById("review-operations-alerts")!,
  revocations: document.getElementById("review-operations-revocations")!,
};
const remaining = document.getElementById("review-operations-remaining")!;

export function clearOperationsDetail() {
  content.hidden = true;
  advisory.textContent = "";
  remaining.textContent = "";
  for (const list of Object.values(lists)) list.replaceChildren();
}

export function showOperationsDetail(value: unknown): string {
  const details = reviewOperationsDetail(value);
  clearOperationsDetail();
  for (const key of Object.keys(lists) as Array<keyof typeof lists>) {
    const fragment = document.createDocumentFragment();
    for (const line of details[key]) {
      const item = document.createElement("li");
      item.textContent = line;
      fragment.append(item);
    }
    lists[key].replaceChildren(fragment);
  }
  advisory.textContent = details.advisory;
  remaining.textContent = details.remaining
    ? `${details.remaining} additional pending revocation(s) are not shown. The server returns at most the oldest 100 identities.`
    : "All pending revocation identities in this snapshot are shown.";
  content.hidden = false;
  return details.summary;
}
