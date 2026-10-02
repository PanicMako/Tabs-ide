import { request } from "./api";
import { reviewAppeals, appealResponse } from "../lib/reviewAppeals";

const list = document.getElementById("review-appeals")!;
const status = document.getElementById("review-appeals-status")!;
let generation = 0;
let responding = false;

export function clearReviewAppeals() {
  generation++;
  list.replaceChildren();
  status.textContent = "Appeals have not been loaded.";
}

export async function showReviewAppeals(signal: AbortSignal) {
  clearReviewAppeals();
  const current = generation;
  status.textContent = "Loading open appeals…";
  try {
    const data = await request<unknown>("/v1/review/appeals", "GET", undefined, signal);
    if (current !== generation || signal.aborted) return;
    const entries = reviewAppeals(data);
    for (const entry of entries) {
      const item = document.createElement("li");
      const identity = document.createElement("h3");
      identity.textContent = `${entry.namespace}.${entry.name}@${entry.version} · Appeal ${entry.id}`;
      const evidence = document.createElement("p");
      evidence.textContent = `${entry.status}. SHA-256 ${entry.digest}. Original decision: ${entry.review_reason ?? "Not recorded"}. Publisher message: ${entry.message}`;
      const form = document.createElement("form");
      const fields = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = `Respond to appeal ${entry.id}`;
      const label = document.createElement("label");
      const response = document.createElement("textarea");
      response.id = `review-appeal-response-${entry.id}`;
      response.required = true;
      response.maxLength = 4000;
      label.htmlFor = response.id;
      label.textContent = "Response visible to this namespace's publishers (up to 4000 characters)";
      const button = document.createElement("button");
      button.type = "submit";
      button.textContent = "Send appeal response";
      const result = document.createElement("p");
      result.setAttribute("role", "status");
      fields.append(legend, label, response, button);
      form.append(fields, result);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (responding || fields.disabled || current !== generation || signal.aborted) return;
        let decision: ReturnType<typeof appealResponse>;
        try {
          decision = appealResponse(entry.id, response.value);
        } catch (error) {
          result.textContent = error instanceof Error ? error.message : "Check the response.";
          response.focus();
          return;
        }
        responding = true;
        fields.disabled = true;
        result.textContent = "Recording appeal response…";
        try {
          await request(decision.path, "POST", decision.body);
          if (current !== generation || signal.aborted) return;
          result.textContent =
            "Response recorded. This does not change the release decision or publish a package. Refresh the queue.";
        } catch {
          if (current !== generation || signal.aborted) return;
          result.textContent =
            "Response could not be confirmed and may have been accepted. Refresh the queue before retrying. No automatic retry was made.";
        } finally {
          responding = false;
        }
      });
      item.append(identity, evidence, form);
      list.append(item);
    }
    status.textContent = entries.length
      ? `${entries.length} open appeals shown, oldest first (maximum 100).`
      : "No open appeals found.";
  } catch {
    if (current === generation && !signal.aborted)
      status.textContent =
        "Appeals could not be loaded. Refresh and check reviewer access; do not assume the queue is empty.";
  }
}
window.addEventListener("pagehide", clearReviewAppeals);
