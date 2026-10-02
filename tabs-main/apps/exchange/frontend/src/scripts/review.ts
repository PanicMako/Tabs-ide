import { request, RegistryRequestError, type Actor } from "./api";
import { reviewArchivePath, reviewDecision, reviewRescan } from "../lib/reviewDecision";
import { clearReviewHistory, showReviewHistory } from "./review-history";
import { clearOperationsDetail, showOperationsDetail } from "./review-operations";
import { clearReviewAppeals, showReviewAppeals } from "./review-appeals";
import { appendReviewEvidence } from "./review-evidence";

interface Submission {
  namespace: string;
  name: string;
  version: string;
  digest: string;
  status: string;
  manifest: unknown;
  scan_result: unknown;
}
const status = document.getElementById("review-status")!;
const content = document.getElementById("review-content")!;
const list = document.getElementById("review-items")!;
const refresh = document.getElementById("review-refresh") as HTMLButtonElement;
const signin = document.getElementById("review-signin")!;
let generation = 0;
let pending: AbortController | undefined;
let deciding = false;
let operationsGeneration = 0;
const operations = document.getElementById("review-operations")!;
function reconnectReviewer() {
  operationsGeneration++;
  content.hidden = true;
  list.replaceChildren();
  clearReviewHistory();
  clearReviewAppeals();
  clearOperationsDetail();
  operations.textContent = "Reviewer access must be checked again.";
  signin.hidden = false;
  status.textContent =
    "Reviewer access expired or was removed. Sign in again with an authorized account.";
}
async function showOperations(current: number, signal?: AbortSignal) {
  const operation = ++operationsGeneration;
  clearOperationsDetail();
  operations.textContent = "Loading signing backlog and worker status…";
  try {
    const data = await request<unknown>("/v1/review/operations", "GET", undefined, signal);
    if (current === generation && operation === operationsGeneration)
      operations.textContent = showOperationsDetail(data);
  } catch (error) {
    if (current === generation && operation === operationsGeneration && !signal?.aborted) {
      clearOperationsDetail();
      if (error instanceof RegistryRequestError && (error.status === 401 || error.status === 403)) {
        reconnectReviewer();
      } else {
        operations.textContent =
          "Operational status unavailable. Refresh to retry; do not assume the worker or signing pipeline is healthy.";
      }
    }
  }
}

function decisionForm(entry: Submission, index: number) {
  const form = document.createElement("form");
  const fields = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = `Decision for ${entry.namespace}.${entry.name}@${entry.version}`;
  fields.append(legend);
  const reason = document.createElement("textarea");
  reason.id = `review-reason-${index}`;
  reason.required = true;
  reason.maxLength = 2000;
  const reasonLabel = document.createElement("label");
  reasonLabel.htmlFor = reason.id;
  reasonLabel.textContent = "Decision reason (recorded in the audit trail)";
  const digest = document.createElement("input");
  digest.id = `review-confirm-${index}`;
  digest.required = true;
  digest.maxLength = 64;
  digest.autocomplete = "off";
  const digestLabel = document.createElement("label");
  digestLabel.htmlFor = digest.id;
  digestLabel.textContent = "Paste the displayed SHA-256 digest to confirm this package";
  const result = document.createElement("p");
  result.setAttribute("role", "status");
  const approve = document.createElement("button");
  approve.type = "submit";
  approve.value = "approve";
  approve.textContent = "Approve exact digest";
  approve.hidden = entry.status === "approved";
  const scan = entry.scan_result as { passed?: boolean; digest?: string } | null;
  approve.disabled = scan?.passed !== true || scan?.digest !== entry.digest;
  const reject = document.createElement("button");
  reject.type = "submit";
  reject.value = entry.status === "approved" ? "revoke" : "reject";
  reject.textContent = entry.status === "approved" ? "Revoke exact digest" : "Reject exact digest";
  const rescan = document.createElement("button");
  rescan.type = "submit";
  rescan.value = "rescan";
  rescan.textContent = "Request a new scan for this digest";
  rescan.hidden = entry.status !== "review";
  fields.append(reasonLabel, reason, digestLabel, digest, approve, reject, rescan);
  form.append(fields, result);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (deciding) return;
    let decision: ReturnType<typeof reviewDecision> | ReturnType<typeof reviewRescan>;
    const action = (event.submitter as HTMLButtonElement | null)?.value ?? "";
    try {
      decision =
        action === "rescan" && entry.status === "review"
          ? reviewRescan(entry, reason.value, digest.value)
          : reviewDecision(
              entry,
              action,
              reason.value,
              digest.value,
              entry.status === "approved" ? "approved" : "review",
            );
    } catch (error) {
      result.textContent = error instanceof Error ? error.message : "Check the decision fields.";
      return;
    }
    deciding = true;
    refresh.disabled = true;
    fields.disabled = true;
    result.textContent = "Recording decision…";
    try {
      await request(decision.path, "POST", decision.body);
      result.textContent =
        action === "rescan"
          ? "Rescan queued. Existing scan evidence is no longer current. Refresh the queue before making another decision."
          : action === "approve"
            ? "Approval recorded. This is not publication: a signed release is still required. Refresh the queue."
            : action === "revoke"
              ? "Revocation recorded. Publish updated signed metadata promptly so installed clients can authenticate the revocation. Refresh the queue."
              : "Rejection recorded. Refresh the queue.";
    } catch (error) {
      if (error instanceof RegistryRequestError && (error.status === 401 || error.status === 403)) {
        reconnectReviewer();
      } else {
        result.textContent =
          "The decision could not be confirmed. It may have been accepted. Refresh the queue and inspect audit history before retrying; no automatic retry was made.";
      }
    } finally {
      deciding = false;
      refresh.disabled = false;
      refresh.focus();
      if (!content.hidden) {
        void showReviewHistory(entry.namespace, entry.name);
        void showOperations(generation, pending?.signal);
      }
    }
  });
  return form;
}

async function load() {
  if (deciding) return;
  clearReviewHistory();
  clearReviewAppeals();
  clearOperationsDetail();
  operations.textContent = "Operational status has not been loaded.";
  content.hidden = true;
  list.replaceChildren();
  const current = ++generation;
  pending?.abort();
  const controller = new AbortController();
  pending = controller;
  refresh.disabled = true;
  status.textContent = "Checking reviewer access and loading the queue…";
  try {
    const actor = await request<Actor | null>("/v1/me", "GET", undefined, controller.signal);
    if (current !== generation) return;
    content.hidden = true;
    list.replaceChildren();
    signin.hidden = actor !== null;
    if (!actor?.admin) {
      status.textContent = actor
        ? "This account does not have reviewer access."
        : "Sign in with a reviewer account to continue.";
      return;
    }
    const data = await request<{ submissions: Submission[] }>(
      "/v1/review/queue",
      "GET",
      undefined,
      controller.signal,
    );
    const approved = await request<{
      versions: Array<Omit<Submission, "status" | "manifest" | "scan_result">>;
    }>("/v1/review/approved", "GET", undefined, controller.signal);
    if (current !== generation) return;
    const fragment = document.createDocumentFragment();
    const entries: Submission[] = [
      ...data.submissions,
      ...approved.versions.map((entry) => ({
        ...entry,
        status: "approved",
        manifest: null,
        scan_result: null,
      })),
    ];
    for (const [index, entry] of entries.entries()) {
      const item = document.createElement("li");
      const heading = document.createElement("h2");
      heading.textContent = `${entry.namespace}.${entry.name}@${entry.version}`;
      const identity = document.createElement("p");
      identity.textContent = `${entry.status} · SHA-256 ${entry.digest}${entry.status === "approved" ? ". Approval alone does not prove signed publication." : ""}`;
      item.append(heading, identity);
      const history = document.createElement("button");
      history.type = "button";
      history.textContent = `View history for ${entry.namespace}.${entry.name}`;
      history.addEventListener("click", () => {
        void showReviewHistory(entry.namespace, entry.name);
        document.getElementById("review-history-namespace")!.focus();
      });
      item.append(history);
      const archive = document.createElement("a");
      archive.href = reviewArchivePath(entry);
      archive.textContent = `Download ${entry.namespace}.${entry.name}@${entry.version} for independent inspection`;
      item.append(archive);
      if (entry.status !== "approved")
        appendReviewEvidence(item, entry.manifest, entry.scan_result, entry.digest);
      const evidenceSections: Array<readonly [string, unknown]> =
        entry.status === "approved"
          ? []
          : [
              ["Raw manifest evidence", entry.manifest],
              ["Raw scan and version-difference evidence", entry.scan_result],
            ];
      for (const [label, evidence] of evidenceSections) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = label;
        const text = document.createElement("pre");
        text.textContent =
          evidence === null
            ? "Scan evidence is not available yet."
            : JSON.stringify(evidence, null, 2);
        details.append(summary, text);
        item.append(details);
      }
      if (entry.status === "review" || entry.status === "approved")
        item.append(decisionForm(entry, index));
      fragment.append(item);
    }
    list.replaceChildren(fragment);
    content.hidden = false;
    void showOperations(current, controller.signal);
    void showReviewAppeals(controller.signal);
    status.textContent = `${data.submissions.length} pending submissions and ${approved.versions.length} approved releases loaded. Each list is limited to 100 entries.`;
  } catch (error) {
    if (current === generation && !controller.signal.aborted) {
      content.hidden = true;
      list.replaceChildren();
      if (error instanceof RegistryRequestError && (error.status === 401 || error.status === 403)) {
        reconnectReviewer();
      } else {
        status.textContent =
          "Could not load reviewer evidence. Refresh the queue to retry or sign in again.";
      }
    }
  } finally {
    if (current === generation) refresh.disabled = false;
  }
}
refresh.addEventListener("click", () => void load());
window.addEventListener("pagehide", () => {
  generation++;
  pending?.abort();
  clearOperationsDetail();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) void load();
});
void load();
