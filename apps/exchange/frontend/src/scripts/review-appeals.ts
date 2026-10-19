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
      item.className = "appeal-card";
      const badge = document.createElement("span");
      badge.className = "review-status-badge";
      badge.textContent = entry.status;
      const conversation = document.createElement("div");
      conversation.className = "appeal-conversation";
      for (const [title, text] of [
        ["Publisher’s message", entry.message],
        ["Original review decision", entry.review_reason ?? "No reason recorded."],
      ]) {
        const section = document.createElement("section");
        const heading = document.createElement("h4");
        heading.textContent = title!;
        const paragraph = document.createElement("p");
        paragraph.textContent = text!;
        section.append(heading, paragraph);
        conversation.append(section);
      }
      const evidence = document.createElement("details");
      evidence.className = "history-record-digest";
      const evidenceTitle = document.createElement("summary");
      evidenceTitle.textContent = "Package fingerprint";
      const digest = document.createElement("code");
      digest.textContent = `SHA-256 ${entry.digest}`;
      evidence.append(evidenceTitle, digest);
      const reply = document.createElement("button");
      reply.type = "button";
      reply.className = "button secondary";
      reply.textContent = "Reply to publisher";
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
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "button secondary";
      cancel.textContent = "Cancel";
      fields.append(cancel);
      form.append(fields, result);
      form.hidden = true;
      reply.addEventListener("click", () => {
        form.hidden = false;
        reply.hidden = true;
        response.focus();
      });
      cancel.addEventListener("click", () => {
        form.hidden = true;
        reply.hidden = false;
        reply.focus();
      });
      button.className = "button";
      form.noValidate = true;
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
      item.append(badge, identity, conversation, evidence, reply, form);
      list.append(item);
    }
    if (!entries.length) {
      const empty = document.createElement("li");
      empty.className = "service-welcome";
      const symbol = document.createElement("span");
      symbol.className = "welcome-symbol";
      symbol.setAttribute("aria-hidden", "true");
      symbol.textContent = "↗";
      const copy = document.createElement("div");
      const heading = document.createElement("h3");
      heading.textContent = "You’re all caught up.";
      const detail = document.createElement("p");
      detail.textContent =
        "There are no open appeals in this queue. When a publisher asks you to reconsider a decision, their message will appear here alongside the original review.";
      copy.append(heading, detail);
      empty.append(symbol, copy);
      list.append(empty);
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
