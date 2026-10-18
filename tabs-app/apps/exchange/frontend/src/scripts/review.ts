import { request, RegistryRequestError, type Actor } from "./api";
import { reviewArchivePath, reviewDecision, reviewRescan } from "../lib/reviewDecision";
import { clearReviewHistory, showReviewHistory } from "./review-history";
import { clearOperationsDetail, showOperationsDetail } from "./review-operations";
import { clearReviewAppeals, showReviewAppeals } from "./review-appeals";
import { appendReviewEvidence } from "./review-evidence";
import { reviewPresentation } from "../lib/reviewPresentation";
import { filterReviewPackages } from "../lib/reviewFilter";

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
const query = document.getElementById("review-query") as HTMLInputElement;
const scope = document.getElementById("review-scope") as HTMLSelectElement;
function filter() {
  document.getElementById("review-filter-status")!.textContent = filterReviewPackages(
    list,
    query.value,
    scope.value,
  );
}
query.addEventListener("input", filter);
scope.addEventListener("change", filter);
let generation = 0;
let pending: AbortController | undefined;
let deciding = false;
let operationsGeneration = 0;
const operations = document.getElementById("review-operations")!;
function reconnectReviewer() {
  const lostFocus = content.contains(document.activeElement);
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
  if (lostFocus) signin.focus();
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

function fingerprintControl(value: string) {
  const wrapper = document.createElement("div");
  wrapper.className = "review-fingerprint";
  const label = document.createElement("span");
  label.textContent = "SHA-256 · exact package fingerprint";
  const code = document.createElement("code");
  code.textContent = value;
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy fingerprint";
  const feedback = document.createElement("span");
  feedback.setAttribute("role", "status");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(value);
      feedback.textContent = "Copied. Paste it in the confirmation field.";
    } catch {
      feedback.textContent =
        "Copy this fingerprint manually, then paste it in the confirmation field.";
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(code);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  });
  wrapper.append(label, code, copy, feedback);
  return wrapper;
}

function decisionForm(entry: Submission, index: number) {
  const form = document.createElement("form");
  form.className = "task-form";
  form.noValidate = true;
  const fields = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = `Your decision · ${entry.namespace}.${entry.name}@${entry.version}`;
  fields.append(legend);
  const reason = document.createElement("textarea");
  reason.id = `review-reason-${index}`;
  reason.required = true;
  reason.maxLength = 2000;
  const reasonLabel = document.createElement("label");
  reasonLabel.htmlFor = reason.id;
  reasonLabel.textContent = "What did you find?";
  reason.placeholder = "Describe what you checked and why you’re making this decision.";
  reason.rows = 3;
  const digest = document.createElement("input");
  digest.id = `review-confirm-${index}`;
  digest.required = true;
  digest.maxLength = 64;
  digest.autocomplete = "off";
  const digestLabel = document.createElement("label");
  digestLabel.htmlFor = digest.id;
  digestLabel.textContent = "Confirm this package’s fingerprint";
  digest.placeholder = "Paste the SHA-256 fingerprint shown below";
  const result = document.createElement("p");
  result.setAttribute("role", "status");
  const approve = document.createElement("button");
  approve.className = "button";
  approve.type = "submit";
  approve.value = "approve";
  approve.textContent = "Approve this version";
  approve.hidden = entry.status === "approved";
  approve.disabled = reviewPresentation(entry).tone !== "ready";
  const reject = document.createElement("button");
  reject.className = "button secondary";
  reject.type = "submit";
  reject.value = entry.status === "approved" ? "revoke" : "reject";
  reject.textContent = entry.status === "approved" ? "Revoke this version" : "Reject this version";
  const rescan = document.createElement("button");
  rescan.className = "button secondary";
  rescan.type = "submit";
  rescan.value = "rescan";
  rescan.textContent = "Request a new scan";
  rescan.hidden = entry.status !== "review";
  const reasonField = document.createElement("div");
  reasonField.className = "form-field";
  reasonField.append(reasonLabel, reason);
  const digestField = document.createElement("div");
  digestField.className = "form-field";
  digestField.append(digestLabel, digest);
  const actions = document.createElement("div");
  actions.className = "form-actions";
  actions.append(approve, reject, rescan);
  const help = document.createElement("p");
  help.className = "review-decision-help";
  help.textContent =
    "Your reason is recorded for the publisher. Approval moves this version to signing; it does not publish it immediately.";
  fields.append(help, reasonField, fingerprintControl(entry.digest), digestField, actions);
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
      (content.hidden ? (signin.hidden ? status : signin) : refresh).focus();
      if (!content.hidden) {
        void showReviewHistory(entry.namespace, entry.name);
        void showOperations(generation, pending?.signal);
      }
    }
  });
  return form;
}

async function load(restoreFocus = false) {
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
      item.dataset.reviewIdentity = `${entry.namespace}.${entry.name}@${entry.version} ${entry.digest}`;
      item.dataset.reviewStatus = entry.status;
      const presentation = reviewPresentation(entry);
      item.dataset.reviewTone = presentation.tone;
      const heading = document.createElement("h3");
      const manifest =
        entry.manifest && typeof entry.manifest === "object"
          ? (entry.manifest as { displayName?: unknown; description?: unknown })
          : undefined;
      heading.textContent =
        typeof manifest?.displayName === "string"
          ? manifest.displayName
          : `${entry.namespace}.${entry.name}@${entry.version}`;
      const badge = document.createElement("span");
      badge.className = "review-package-badge";
      badge.textContent = presentation.label;
      const identity = document.createElement("p");
      identity.className = "review-package-identity";
      identity.textContent = `${entry.namespace}.${entry.name} · Version ${entry.version}`;
      const guidance = document.createElement("p");
      guidance.className = "review-package-guidance";
      guidance.textContent = presentation.guidance;
      item.append(badge, heading, identity, guidance);
      const history = document.createElement("button");
      history.type = "button";
      history.textContent = "Release history";
      history.setAttribute("aria-label", `View history for ${entry.namespace}.${entry.name}`);
      history.addEventListener("click", () => {
        void showReviewHistory(entry.namespace, entry.name);
        document
          .querySelector<HTMLAnchorElement>('[data-workspace-target="review-history-panel"]')
          ?.click();
        document.getElementById("review-history-namespace")!.focus();
      });
      const tools = document.createElement("div");
      tools.className = "review-package-tools";
      tools.append(history);
      const archive = document.createElement("a");
      archive.href = reviewArchivePath(entry);
      archive.textContent = "Download package ↗";
      archive.setAttribute(
        "aria-label",
        `Download ${entry.namespace}.${entry.name}@${entry.version} for independent inspection`,
      );
      tools.append(archive);
      item.append(tools);
      const inspection = document.createElement("details");
      inspection.className = "package-inspection";
      const inspectionHeading = document.createElement("summary");
      inspectionHeading.textContent =
        entry.status === "approved" ? "Manage this release" : "Review this package";
      inspection.append(inspectionHeading);
      const intro = document.createElement("div");
      intro.className = "review-checklist";
      intro.textContent =
        entry.status === "approved"
          ? "This review is complete. Record a reason and confirm the package fingerprint before revoking it."
          : "01 Inspect requested access   →   02 Read scan findings & changes   →   03 Record your decision";
      inspection.append(intro);
      if (entry.status !== "approved")
        appendReviewEvidence(inspection, entry.manifest, entry.scan_result, entry.digest);
      const evidenceSections: Array<readonly [string, unknown]> =
        entry.status === "approved"
          ? []
          : [
              ["Raw manifest evidence", entry.manifest],
              ["Raw scan and version-difference evidence", entry.scan_result],
            ];
      const technical = document.createElement("details");
      technical.className = "review-technical";
      const technicalTitle = document.createElement("summary");
      technicalTitle.textContent = "Technical evidence · manifest & scan data";
      technical.append(technicalTitle, fingerprintControl(entry.digest));
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
        technical.append(details);
      }
      inspection.append(technical);
      if (entry.status === "review" || entry.status === "approved")
        inspection.append(decisionForm(entry, index));
      item.append(inspection);
      fragment.append(item);
    }
    list.replaceChildren(fragment);
    if (!entries.length) {
      const empty = document.createElement("li");
      empty.className = "review-empty";
      const title = document.createElement("h3");
      title.textContent = "A clear desk.";
      const message = document.createElement("p");
      message.textContent =
        "No pending submissions or approved releases were returned. Refresh the queue to check for new work.";
      empty.append(title, message);
      list.append(empty);
    }
    const counts = {
      "review-ready-count": data.submissions.filter(
        (entry) => reviewPresentation(entry).tone === "ready",
      ).length,
      "review-scanning-count": data.submissions.filter((entry) =>
        ["queued", "scanning"].includes(entry.status),
      ).length,
      "review-approved-count": approved.versions.length,
    };
    for (const [id, count] of Object.entries(counts)) {
      const target = document.getElementById(id);
      if (target) target.textContent = String(count);
    }
    filter();
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
    if (current === generation) {
      refresh.disabled = false;
      if (
        restoreFocus &&
        !controller.signal.aborted &&
        (document.activeElement === document.body || document.activeElement === refresh)
      )
        (content.hidden ? (signin.hidden ? status : signin) : refresh).focus();
    }
  }
}
refresh.addEventListener("click", () => void load(true));
window.addEventListener("pagehide", () => {
  generation++;
  pending?.abort();
  clearOperationsDetail();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) void load();
});
void load();
