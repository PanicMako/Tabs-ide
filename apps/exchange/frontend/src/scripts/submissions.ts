import { request, RegistryRequestError } from "./api";
import { submissionPresentation } from "../lib/submissionPresentation";
import { utcTimeLabel } from "../lib/utcTime";
import { submissionLifecycle } from "@tabs/shared/extensionSubmission";

interface Submission {
  namespace: string;
  name: string;
  version: string;
  digest: string;
  status: string;
  published: boolean;
  submitted_at?: string;
}
const refresh = document.getElementById("submissions-refresh") as HTMLButtonElement;
const status = document.getElementById("submissions-count")!;
const list = document.getElementById("account-submissions")!;
let loading = false;
let generation = 0;
let pending: AbortController | undefined;
const studio = document.querySelector(".submission-studio");
const search = document.getElementById("submission-search") as HTMLInputElement | null;
const filters = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-submission-filter]"),
);
let entries: Submission[] = [];
let loaded = false;
let filter = "all";
function counts() {
  for (const counter of document.querySelectorAll<HTMLElement>("[data-submission-count]")) {
    const group = counter.dataset.submissionCount;
    counter.textContent = loaded
      ? String(
          entries.filter(
            (entry) => group === "all" || submissionPresentation(entry).group === group,
          ).length,
        )
      : "—";
  }
  for (const button of filters) {
    button.disabled = !loaded;
    button.setAttribute("aria-pressed", String(button.dataset.submissionFilter === filter));
  }
  if (search) search.disabled = !loaded;
}
function render() {
  counts();
  const query = search?.value.trim().toLowerCase() ?? "";
  const visible = entries.filter(
    (entry) =>
      (filter === "all" || submissionPresentation(entry).group === filter) &&
      `${entry.namespace}.${entry.name}@${entry.version}`.toLowerCase().includes(query),
  );
  const fragment = document.createDocumentFragment();
  for (const submission of visible) {
    const item = document.createElement("li");
    const presentation = submissionPresentation(submission);
    item.dataset.state = presentation.group;
    const link = document.createElement("a");
    link.href = `/account/submissions/${submission.digest}`;
    link.className = "submission-link";
    const publisher = document.createElement("span");
    publisher.className = "submission-publisher";
    publisher.textContent = `${submission.namespace}.`;
    const tool = document.createElement("strong");
    tool.className = "submission-tool";
    tool.textContent = submission.name;
    const version = document.createElement("span");
    version.className = "submission-version";
    version.textContent = `@${submission.version}`;
    link.append(publisher, tool, version);
    const state = document.createElement("span");
    state.className = "submission-state-badge";
    state.textContent = studio ? presentation.label : submissionLifecycle(submission).label;
    if (studio) {
      const header = document.createElement("div");
      header.className = "submission-card-heading";
      header.append(link, state);
      const explanation = document.createElement("p");
      explanation.className = "submission-card-explanation";
      explanation.textContent = presentation.explanation;
      const footer = document.createElement("div");
      footer.className = "submission-card-footer";
      const next = document.createElement("p");
      next.textContent = presentation.next;
      const action = document.createElement("a");
      action.href = link.href;
      action.textContent = "View progress ↗";
      action.setAttribute(
        "aria-label",
        `View progress for ${submission.namespace}.${submission.name}@${submission.version}`,
      );
      footer.append(next, action);
      const technical = document.createElement("details");
      technical.className = "submission-fingerprint";
      const summary = document.createElement("summary");
      summary.textContent = "Package fingerprint";
      const digest = document.createElement("code");
      digest.textContent = submission.digest;
      technical.append(summary, digest);
      item.append(header, explanation);
      if (
        typeof submission.submitted_at === "string" &&
        Number.isFinite(Date.parse(submission.submitted_at))
      ) {
        const time = document.createElement("time");
        time.dateTime = submission.submitted_at;
        time.title = submission.submitted_at;
        time.textContent = `Submitted ${utcTimeLabel(submission.submitted_at)}`;
        item.append(time);
      }
      item.append(footer, technical);
    } else {
      const digest = document.createElement("p");
      digest.className = "submission-digest";
      digest.textContent = `SHA-256 ${submission.digest}`;
      item.append(link, state, digest);
    }
    fragment.append(item);
  }
  if (!entries.length) {
    const empty = document.createElement("li");
    empty.className = "submission-empty";
    const heading = document.createElement("h3");
    heading.textContent = "Your first release starts here.";
    const guidance = document.createElement("p");
    guidance.textContent =
      "Submit a built .tabsext package. Its status, review feedback and next steps will appear here.";
    const start = document.createElement("a");
    start.href = "/publish";
    start.textContent = "Submit your first package ↗";
    const tools = document.createElement("a");
    tools.href = "/developers";
    tools.textContent = "Still building? Get the developer tools ↗";
    empty.append(heading, guidance, start, tools);
    fragment.append(empty);
  } else if (!visible.length) {
    const empty = document.createElement("li");
    empty.className = "submission-empty";
    const heading = document.createElement("h3");
    heading.textContent = "No versions match this view.";
    const guidance = document.createElement("p");
    guidance.textContent = "Try another name or status, or show all submissions.";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "button secondary";
    reset.textContent = "Show all submissions";
    reset.addEventListener("click", () => {
      filter = "all";
      if (search) search.value = "";
      render();
      (search ?? refresh).focus();
    });
    empty.append(heading, guidance, reset);
    fragment.append(empty);
  }
  list.replaceChildren(fragment);
  status.textContent = entries.length
    ? visible.length === entries.length
      ? `${entries.length} recent version${entries.length === 1 ? "" : "s"}. Open a version to follow its progress.`
      : `${visible.length} of ${entries.length} recent versions match this view.`
    : "No submissions yet. Your first package will appear here.";
}
for (const button of filters)
  button.addEventListener("click", () => {
    if (!loaded) return;
    filter = button.dataset.submissionFilter ?? "all";
    render();
  });
search?.addEventListener("input", () => {
  if (loaded) render();
});
counts();
async function load() {
  if (loading) return;
  loading = true;
  const current = ++generation;
  const controller = new AbortController();
  pending = controller;
  const restoreFocus = document.activeElement === refresh;
  refresh.disabled = true;
  refresh.textContent = "Refreshing…";
  list.setAttribute("aria-busy", "true");
  try {
    const body = await request<{ submissions: Submission[] }>(
      "/v1/publisher/submissions",
      "GET",
      undefined,
      controller.signal,
    );
    if (current !== generation || controller.signal.aborted) return;
    if (
      !Array.isArray(body?.submissions) ||
      body.submissions.length > 100 ||
      body.submissions.some(
        (entry) =>
          !entry ||
          typeof entry.namespace !== "string" ||
          typeof entry.name !== "string" ||
          typeof entry.version !== "string" ||
          typeof entry.digest !== "string" ||
          !/^[a-z][a-z0-9-]{1,62}$/.test(entry.namespace) ||
          !/^[a-z][a-z0-9-]{1,62}$/.test(entry.name) ||
          !/^[0-9A-Za-z.+-]{1,128}$/.test(entry.version) ||
          !/^[a-f0-9]{64}$/.test(entry.digest) ||
          typeof entry.published !== "boolean" ||
          submissionLifecycle(entry).code === "unknown",
      )
    )
      throw new Error(
        "Registry returned an invalid submission list. Refresh or contact its operator.",
      );
    entries = body.submissions;
    delete status.dataset.state;
    loaded = true;
    render();
  } catch (error) {
    if (current !== generation || controller.signal.aborted) return;
    status.dataset.state = "error";
    entries = [];
    loaded = false;
    counts();
    list.replaceChildren();
    if (error instanceof RegistryRequestError && [401, 403].includes(error.status)) {
      const content = document.getElementById("account-content");
      if (content) content.hidden = true;
      const signin = document.getElementById("account-signin");
      if (signin) signin.hidden = false;
      const accountStatus = document.getElementById("account-status");
      if (accountStatus) accountStatus.textContent = error.message;
      if (restoreFocus) document.getElementById("account-signin-link")?.focus();
    }
    status.textContent =
      error instanceof Error ? error.message : "Submissions unavailable. Refresh to retry.";
  } finally {
    if (current === generation) {
      loading = false;
      refresh.disabled = false;
      refresh.textContent = "Refresh status";
      list.setAttribute("aria-busy", "false");
      if (
        restoreFocus &&
        (document.activeElement === refresh || document.activeElement === document.body)
      )
        refresh.focus();
    }
  }
}
window.addEventListener("pagehide", () => {
  generation++;
  pending?.abort();
  entries = [];
  loaded = false;
  counts();
  list.replaceChildren();
  loading = false;
  refresh.disabled = false;
  status.textContent = "Refresh to load current submissions.";
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) void load();
});
refresh.addEventListener("click", () => void load());
void load();
