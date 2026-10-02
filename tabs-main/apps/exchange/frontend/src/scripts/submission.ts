import { submissionLifecycle } from "@tabs/shared/extensionSubmission";
import { request, RegistryRequestError, type Actor } from "./api";
import { clearSubmissionView } from "../lib/submissionView";
import { submissionAppeals } from "../lib/submissionAppeals";

interface Submission {
  namespace: string;
  name: string;
  version: string;
  digest: string;
  status: string;
  published: boolean;
  submitted_at?: string;
  reviewed_at?: string;
  scan_claimed_at?: string;
  scan_started_at?: string;
  scan_completed_at?: string;
  review_reason?: string;
  manifest?: { engines?: { tabs?: string; api?: string } };
  scan_result?: { issues?: Array<{ code?: string; message?: string }> };
}
const state = document.getElementById("submission-state")!;
const refresh = document.getElementById("submission-refresh") as HTMLButtonElement;
const id = /^\/account\/submissions\/([a-f0-9]{64})\/?$/.exec(location.pathname)?.[1];
let timer: ReturnType<typeof setTimeout> | undefined;
let active = true;
let loading = false;
let generation = 0;
let pending: AbortController | undefined;
let selected: Submission | undefined;
const correction = document.getElementById("submission-correction-options")!;
const appealForm = document.getElementById("submission-appeal") as HTMLFormElement;
const appealMessage = document.getElementById("submission-appeal-message") as HTMLTextAreaElement;
const appealFields = document.getElementById("submission-appeal-fields") as HTMLFieldSetElement;
const appealState = document.getElementById("submission-appeal-state")!;
appealForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submission = selected;
  if (!submission || appealFields.disabled || !["rejected", "revoked"].includes(submission.status))
    return;
  const message = appealMessage.value.trim();
  if (!message || appealMessage.value.length > 4000) {
    appealState.textContent = "Enter an appeal of 1 to 4000 characters.";
    appealMessage.focus();
    return;
  }
  appealFields.disabled = true;
  const current = generation;
  appealState.textContent = "Submitting appeal for the displayed digest…";
  try {
    await request(
      `/v1/publisher/${submission.namespace}/${submission.name}/versions/${encodeURIComponent(submission.version)}/appeals`,
      "POST",
      { digest: submission.digest, message },
    );
    if (current !== generation) return;
    appealState.textContent =
      "Appeal submitted. It does not change the release decision or publish the package. Refresh status to check for a reviewer response.";
  } catch {
    if (current !== generation) return;
    appealState.textContent =
      "The appeal could not be confirmed and may already have been accepted. Refresh status to check appeal history before retrying. No automatic retry was made.";
  }
});

function metadata(label: string, value: string) {
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  document.getElementById("submission-metadata")!.append(term, description);
}
async function load() {
  if (!id || loading) return;
  loading = true;
  selected = undefined;
  correction.hidden = true;
  const current = ++generation;
  const controller = new AbortController();
  pending = controller;
  refresh.disabled = true;
  clearTimeout(timer);
  try {
    const actor = await request<Actor | null>("/v1/me", "GET", undefined, controller.signal);
    if (current !== generation) return;
    if (!actor) {
      clearSubmissionView(document);
      document.getElementById("account-signin")!.hidden = false;
      state.textContent = "Sign in to view this submission.";
      active = false;
      return;
    }
    document.getElementById("account-signin")!.hidden = true;
    const submission = await request<Submission>(
      `/v1/publisher/submissions/${id}`,
      "GET",
      undefined,
      controller.signal,
    );
    if (current !== generation) return;
    if (
      submission.digest !== id ||
      !/^[a-z][a-z0-9-]{1,62}$/.test(submission.namespace) ||
      !/^[a-z][a-z0-9-]{1,62}$/.test(submission.name) ||
      !/^[0-9A-Za-z.+-]{1,128}$/.test(submission.version)
    )
      throw new Error("Submission identity did not match this page.");
    const lifecycle = submissionLifecycle(submission);
    if (lifecycle.code === "unknown")
      throw new Error("Unknown submission state. Contact this instance's operator.");
    active = !lifecycle.terminal;
    selected = submission;
    correction.hidden = !["rejected", "revoked"].includes(lifecycle.code);
    document.getElementById("submission-identity")!.textContent =
      `${submission.namespace}.${submission.name}@${submission.version}`;
    state.textContent = lifecycle.label;
    document.getElementById("submission-metadata")!.replaceChildren();
    metadata("Package SHA-256", submission.digest);
    metadata("Tabs compatibility", submission.manifest?.engines?.tabs ?? "Not available");
    metadata("API compatibility", submission.manifest?.engines?.api ?? "Not declared");
    const timeline = document.getElementById("submission-timeline")!;
    timeline.replaceChildren();
    for (const [label, timestamp] of [
      ["Uploaded", submission.submitted_at],
      ["Latest scan started", submission.scan_started_at],
      ["Latest scan completed", submission.scan_completed_at],
      ["Reviewed", submission.reviewed_at],
    ]) {
      const item = document.createElement("li");
      item.textContent = `${label}: ${timestamp ?? "Not yet recorded"}`;
      timeline.append(item);
    }
    document.getElementById("submission-reason")!.textContent =
      submission.review_reason ?? "No review decision recorded yet.";
    const issues = document.getElementById("submission-issues")!;
    issues.replaceChildren();
    for (const issue of submission.scan_result?.issues?.slice(0, 100) ?? []) {
      const item = document.createElement("li");
      item.textContent = `${issue.code ?? "scan"}: ${issue.message ?? "See scan summary"}`;
      issues.append(item);
    }
    document.getElementById("submission-scan")!.textContent = JSON.stringify(
      submission.scan_result ?? { status: "No scan result yet" },
      null,
      2,
    );
    const listing = document.getElementById("submission-public-link") as HTMLAnchorElement;
    listing.hidden = lifecycle.code !== "published";
    listing.href = `/extensions/${submission.namespace}/${submission.name}`;
    document.getElementById("submission-correction")!.hidden = !["rejected", "revoked"].includes(
      lifecycle.code,
    );
    const appealHistory = document.getElementById("submission-appeals")!;
    const appealHistoryState = document.getElementById("submission-appeals-state")!;
    appealHistory.replaceChildren();
    appealHistoryState.textContent = "Loading appeal history…";
    try {
      const data = await request<unknown>(
        `/v1/publisher/appeals?digest=${id}`,
        "GET",
        undefined,
        controller.signal,
      );
      if (current !== generation) return;
      const appeals = submissionAppeals(data, submission);
      for (const appeal of appeals) {
        const item = document.createElement("li");
        const message = document.createElement("p");
        message.textContent = `Submitted ${appeal.created_at}: ${appeal.message}`;
        const response = document.createElement("p");
        response.textContent =
          appeal.response === null
            ? "Awaiting reviewer response."
            : `Reviewer response (${appeal.responded_at ?? "time not recorded"}): ${appeal.response}`;
        item.append(message, response);
        appealHistory.append(item);
      }
      appealHistoryState.textContent = appeals.length
        ? `${appeals.length} appeal(s) shown for this digest.`
        : "No appeals recorded for this digest.";
    } catch (error) {
      if (current !== generation || controller.signal.aborted) return;
      if (error instanceof RegistryRequestError && [401, 403].includes(error.status)) throw error;
      appealHistoryState.textContent =
        "Appeal history could not be loaded. Refresh status to retry; do not assume no appeal exists.";
    }
  } catch (error) {
    if (current !== generation || controller.signal.aborted) return;
    active = false;
    selected = undefined;
    clearSubmissionView(document);
    if (error instanceof RegistryRequestError && [401, 403].includes(error.status))
      document.getElementById("account-signin")!.hidden = false;
    state.textContent =
      error instanceof Error ? error.message : "Submission status unavailable. Refresh to retry.";
  } finally {
    if (current === generation) {
      loading = false;
      refresh.disabled = false;
      if (active && !document.hidden) timer = setTimeout(() => void load(), 5000);
    }
  }
}
refresh.addEventListener("click", () => {
  active = true;
  void load();
});
document.addEventListener("visibilitychange", () => {
  clearTimeout(timer);
  if (!document.hidden && active) void load();
});
window.addEventListener("pagehide", () => {
  generation++;
  pending?.abort();
  selected = undefined;
  clearSubmissionView(document);
  loading = false;
  active = false;
  clearTimeout(timer);
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    active = true;
    void load();
  }
});
if (!id) state.textContent = "Invalid submission identifier.";
else void load();
