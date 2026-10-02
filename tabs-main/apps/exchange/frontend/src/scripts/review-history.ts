import { request } from "./api";
import { reviewHistoryLines, reviewHistoryPath } from "../lib/reviewHistory";

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
  state.textContent = "Look up an extension to inspect its recent history.";
}

export async function showReviewHistory(publisher: string, extension: string) {
  clearReviewHistory();
  namespace.value = publisher;
  name.value = extension;
  const current = generation;
  const controller = new AbortController();
  pending = controller;
  state.textContent = "Loading reviewer audit history…";
  try {
    const data = await request<unknown>(
      reviewHistoryPath(publisher, extension),
      "GET",
      undefined,
      controller.signal,
    );
    if (current !== generation) return;
    const lines = reviewHistoryLines(data);
    for (const [list, entries, empty] of [
      [versions, lines.versions, "No submitted versions found."],
      [decisions, lines.decisions, "No review actions recorded."],
    ] as const) {
      for (const line of entries.length ? entries : [empty]) {
        const item = document.createElement("li");
        item.textContent = line;
        list.append(item);
      }
    }
    state.textContent = `History for ${publisher}.${extension} loaded. Each list contains up to 100 recent entries, not a complete lifetime history.`;
  } catch {
    if (current === generation && !controller.signal.aborted)
      state.textContent =
        "Could not load audit history. Check the namespace/name and reviewer access, then retry the lookup.";
  }
}
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void showReviewHistory(namespace.value.trim(), name.value.trim());
});
window.addEventListener("pagehide", clearReviewHistory);
