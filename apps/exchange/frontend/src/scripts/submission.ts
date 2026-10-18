import { submissionPresentation } from "../lib/submissionPresentation";
import { utcTimeLabel } from "../lib/utcTime";
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
  scan_result?: { passed?: boolean; issues?: Array<{ code?: string; message?: string }> };
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
let appealing = false;
let appealGeneration = 0;
let pendingAppeal: AbortController | undefined;
appealFields.disabled = true;
appealForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submission = selected;
  if (
    !submission ||
    appealing ||
    appealFields.disabled ||
    !["rejected", "revoked"].includes(submission.status)
  )
    return;
  const message = appealMessage.value.trim();
  if (!message || appealMessage.value.length > 4000) {
    appealState.textContent = "Enter an appeal of 1 to 4000 characters.";
    appealMessage.focus();
    return;
  }
  appealing = true;
  const attempt = ++appealGeneration;
  const controller = new AbortController();
  pendingAppeal = controller;
  const origin = document.activeElement;
  appealFields.disabled = true;
  refresh.disabled = true;
  const current = generation;
  appealState.textContent = "Submitting appeal for the displayed digest…";
  try {
    await request(
      `/v1/publisher/${submission.namespace}/${submission.name}/versions/${encodeURIComponent(submission.version)}/appeals`,
      "POST",
      { digest: submission.digest, message },
      controller.signal,
    );
    if (current !== generation) return;
    appealState.textContent =
      "Appeal submitted. It does not change the release decision or publish the package. Refresh status to check for a reviewer response.";
  } catch {
    if (current !== generation) return;
    appealState.textContent =
      "The appeal could not be confirmed and may already have been accepted. Refresh status to check appeal history before retrying. No automatic retry was made.";
  } finally {
    if (attempt === appealGeneration) {
      appealing = false;
      refresh.disabled = false;
      if (document.activeElement === origin || document.activeElement === document.body)
        refresh.focus();
    }
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
  if (!id || loading || appealing) return;
  loading = true;
  const restoreFocus = document.activeElement === refresh;
  appealFields.disabled = true;
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
    const presentation = submissionPresentation(submission);
    const card = document.getElementById("submission-current");
    if (card) card.dataset.state = presentation.group;
    const explanation = document.getElementById("submission-status-title");
    if (explanation) explanation.textContent = presentation.explanation;
    const next = document.getElementById("submission-next-step");
    if (next) next.textContent = presentation.next;
    const stages = document.getElementById("submission-stage-list");
    if (stages) {
      stages.replaceChildren();
      for (const [index, label] of [
        "Package received",
        "Checks & review",
        "Signed release",
      ].entries()) {
        const item = document.createElement("li");
        const number = document.createElement("span");
        number.setAttribute("aria-hidden", "true");
        number.textContent = String(index + 1).padStart(2, "0");
        const title = document.createElement("strong");
        title.textContent = label;
        if (index === presentation.stage) item.setAttribute("aria-current", "step");
        item.append(number, title);
        stages.append(item);
      }
    }
    const scanSummary = document.getElementById("submission-scan-summary");
    if (scanSummary)
      scanSummary.textContent =
        submission.scan_result?.passed === true
          ? "Automated checks passed for this package. Review and signed publication are separate steps."
          : submission.scan_result?.passed === false
            ? "The scan reported a problem. Read the findings below and the technical results."
            : "No verified scan result is available yet. Refresh status to check again.";

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
      item.dataset.recorded = String(!!timestamp);
      const heading = document.createElement("strong");
      heading.textContent = label!;
      const time = document.createElement("time");
      if (timestamp && Number.isFinite(Date.parse(timestamp))) {
        time.dateTime = timestamp;
        time.title = timestamp;
        time.textContent = utcTimeLabel(timestamp);
      } else time.textContent = timestamp ?? "Not yet recorded";
      item.append(heading, time);
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
      const openAppeal = appeals.some((appeal) => appeal.response === null);
      appealFields.disabled = !["rejected", "revoked"].includes(lifecycle.code) || openAppeal;
      appealState.textContent = openAppeal
        ? "An appeal is awaiting a reviewer response. Refresh status to check its progress."
        : "";
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
      if (
        restoreFocus &&
        (document.activeElement === refresh || document.activeElement === document.body)
      ) {
        const signin = document.getElementById("account-signin");
        (signin && !signin.hidden
          ? document.getElementById("account-signin-link")
          : refresh
        )?.focus();
      }
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
  appealGeneration++;
  pendingAppeal?.abort();
  appealing = false;
  appealFields.disabled = true;
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
