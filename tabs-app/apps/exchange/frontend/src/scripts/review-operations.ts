import { reviewOperationsDetail } from "../lib/reviewOperations";
import { utcTimeLabel } from "../lib/utcTime";
const content = document.getElementById("review-operations-details")!;
const advisory = document.getElementById("review-operations-advisory")!;
const lists = {
  activity: document.getElementById("review-operations-activity")!,
  metadata: document.getElementById("review-operations-metadata")!,
  alerts: document.getElementById("review-operations-alerts")!,
  revocations: document.getElementById("review-operations-revocations")!,
};
const remaining = document.getElementById("review-operations-remaining")!;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
}
export function clearOperationsDetail() {
  content.hidden = true;
  const indicator = document.getElementById("review-health-indicator");
  if (indicator) {
    indicator.textContent =
      "Registry health has not been verified. Open the health view or refresh to check.";
    indicator.dataset.health = "unknown";
  }
  document.getElementById("review-health-metrics")?.replaceChildren();
  const pipeline = document.getElementById("review-health-pipeline");
  if (pipeline) pipeline.textContent = "";
  advisory.textContent = "";
  remaining.textContent = "";
  for (const list of Object.values(lists)) list.replaceChildren();
}
export function showOperationsDetail(value: unknown): string {
  const details = reviewOperationsDetail(value);
  clearOperationsDetail();
  const metrics = document.getElementById("review-health-metrics");
  for (const metric of details.metrics) {
    const card = node("div", undefined, "health-metric");
    card.dataset.tone = metric.tone;
    card.append(
      node("span", metric.label),
      node("strong", metric.value),
      node("small", metric.detail),
    );
    metrics?.append(card);
  }
  const pipeline = document.getElementById("review-health-pipeline");
  if (pipeline) pipeline.textContent = details.pipeline;
  for (const alert of details.alertCards) {
    const item = node("li", undefined, "health-alert");
    item.dataset.level = alert.level;
    item.append(
      node(
        "span",
        alert.level === "critical" ? "Action required" : "Needs attention",
        "review-status-badge",
      ),
      node(
        "h4",
        (
          {
            tuf: "Signing & updates",
            worker: "Scanner",
            queue: "Package queue",
            database: "Database",
            storage: "Package storage",
          } as Record<string, string>
        )[alert.subsystem] ?? alert.subsystem,
      ),
      node("p", alert.message),
    );
    lists.alerts.append(item);
  }
  if (!details.alertCards.length)
    lists.alerts.append(
      node("li", "No operational alerts reported in this snapshot.", "panel-empty"),
    );
  for (const role of details.metadataCards) {
    const item = node("li", undefined, "health-role");
    item.dataset.state = role.state;
    const title = node("div");
    title.append(node("h4", role.title), node("span", role.label, "review-status-badge"));
    item.append(
      title,
      node("code", role.role),
      node(
        "p",
        role.expiresAt ? `Expiry: ${utcTimeLabel(role.expiresAt)}` : "No usable expiry recorded.",
      ),
    );
    if (role.expiresAt) item.title = role.expiresAt;
    lists.metadata.append(item);
  }
  for (const event of details.activityRows) {
    const item = node("li", undefined, "health-activity");
    item.append(node("span", event.label));
    if (event.value === "none recorded") item.append(node("span", "No event recorded"));
    else {
      const time = node("time", utcTimeLabel(event.value));
      time.dateTime = event.value;
      time.title = event.value;
      item.append(time);
    }
    lists.activity.append(item);
  }
  for (const line of details.revocations) lists.revocations.append(node("li", line));
  advisory.textContent = details.advisory;
  const indicator = document.getElementById("review-health-indicator");
  if (indicator) {
    indicator.textContent = details.ready
      ? "No critical alerts reported"
      : "Your registry needs attention";
    indicator.dataset.health = details.ready ? "reported" : "attention";
  }
  remaining.textContent = details.remaining
    ? `${details.remaining} additional pending revocation(s) are not shown. The server returns at most the oldest 100 identities.`
    : "All pending revocation identities in this snapshot are shown.";
  const revocations = document.getElementById(
    "review-revocations-fold",
  ) as HTMLDetailsElement | null;
  if (revocations) revocations.open = details.metrics[3]!.value !== "0";
  content.hidden = false;
  return details.summary;
}
