import { utcTimeLabel } from "../lib/utcTime";
import { request } from "./api";
import { reviewHistoryRecords, reviewHistoryPath } from "../lib/reviewHistory";

const form = document.getElementById("review-history-form") as HTMLFormElement;
const namespace = document.getElementById("review-history-namespace") as HTMLInputElement;
const name = document.getElementById("review-history-name") as HTMLInputElement;
const state = document.getElementById("review-history-status")!;
const versions = document.getElementById("review-history-versions")!;
const decisions = document.getElementById("review-history-decisions")!;
let generation = 0;
let pending: AbortController | undefined;

export function clearReviewHistory() {
  generation++;
  pending?.abort();
  versions.replaceChildren();
  decisions.replaceChildren();
  state.textContent = "Choose an extension to see its versions and review decisions.";
  form.setAttribute("aria-busy", "false");
  const guide = document.getElementById("review-history-guide");
  if (guide) guide.hidden = false;
  const summary = document.getElementById("review-history-summary");
  if (summary) summary.textContent = "";
}

export async function showReviewHistory(publisher: string, extension: string) {
  clearReviewHistory();
  namespace.value = publisher;
  name.value = extension;
  const current = generation;
  const controller = new AbortController();
  pending = controller;
  state.textContent = `Loading history for ${publisher}.${extension}…`;
  form.setAttribute("aria-busy", "true");
  try {
    const data = await request<unknown>(
      reviewHistoryPath(publisher, extension),
      "GET",
      undefined,
      controller.signal,
    );
    if (current !== generation) return;
    const records = reviewHistoryRecords(data);
    for (const [list, entries, empty] of [
      [versions, records.versions, "No submitted versions found."],
      [decisions, records.decisions, "No review actions recorded."],
    ] as const) {
      for (const line of entries.length ? entries : [empty]) {
        const item = document.createElement("li");
        if (typeof line === "string") {
          item.textContent = line;
          item.className = "panel-empty";
        } else {
          item.className = "history-record";
          const heading = document.createElement("strong");
          heading.className = "history-record-title";
          const labels: Record<string, string> = {
            approve: "Approved for signing",
            reject: "Rejected",
            revoke: "Revoked",
            rescan: "Scan requested",
            queued: "Queued for scanning",
            scanning: "Scanning",
            review: "Awaiting review",
            approved: "Approved",
            rejected: "Rejected",
            revoked: "Revoked",
          };
          const key = "action" in line ? line.action : line.status;
          heading.textContent = `${labels[key] ?? key} · ${line.version}`;
          const badge = document.createElement("span");
          badge.className = "review-status-badge";
          badge.textContent = "action" in line ? "Review decision" : "Submitted version";
          item.append(badge);
          const provenance = document.createElement("p");
          provenance.className = "history-record-provenance";
          provenance.append(`${"action" in line ? "Reviewed" : "Uploaded"} by ${line.login} · `);
          const time = document.createElement("time");
          time.dateTime = line.timestamp;
          time.title = line.timestamp;
          time.textContent = utcTimeLabel(line.timestamp);
          provenance.append(time);
          const digest = document.createElement("details");
          digest.className = "history-record-digest";
          const digestTitle = document.createElement("summary");
          digestTitle.textContent = "Package fingerprint";
          const fingerprint = document.createElement("code");
          fingerprint.textContent = `SHA-256 ${line.digest}`;
          digest.append(digestTitle, fingerprint);
          item.append(heading, provenance, digest);
          if ("reason" in line) {
            const reason = document.createElement("p");
            reason.className = "history-record-reason";
            reason.textContent = line.reason;
            item.append(reason);
          }
        }
        list.append(item);
      }
    }
    const guide = document.getElementById("review-history-guide");
    if (guide) guide.hidden = true;
    const summary = document.getElementById("review-history-summary");
    if (summary)
      summary.textContent = `${records.versions.length} version(s) · ${records.decisions.length} review action(s)`;
    state.textContent = `History for ${publisher}.${extension} loaded. Each list contains up to 100 recent entries, not a complete lifetime history.`;
  } catch {
    if (current === generation && !controller.signal.aborted)
      state.textContent =
        "Could not load audit history. Check the namespace/name and reviewer access, then retry the lookup.";
  } finally {
    if (current === generation) form.setAttribute("aria-busy", "false");
  }
}
form.noValidate = true;
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void showReviewHistory(namespace.value.trim(), name.value.trim());
});
window.addEventListener("pagehide", clearReviewHistory);
