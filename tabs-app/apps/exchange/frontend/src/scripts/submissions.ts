import { request, RegistryRequestError } from "./api";
import { submissionLifecycle } from "@tabs/shared/extensionSubmission";

interface Submission {
  namespace: string;
  name: string;
  version: string;
  digest: string;
  status: string;
  published: boolean;
}
const refresh = document.getElementById("submissions-refresh") as HTMLButtonElement;
const status = document.getElementById("submissions-count")!;
const list = document.getElementById("account-submissions")!;
let loading = false;
let generation = 0;
let pending: AbortController | undefined;
async function load() {
  if (loading) return;
  loading = true;
  const current = ++generation;
  const controller = new AbortController();
  pending = controller;
  const restoreFocus = document.activeElement === refresh;
  refresh.disabled = true;
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
    const fragment = document.createDocumentFragment();
    for (const submission of body.submissions) {
      const item = document.createElement("li");
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
      state.textContent = submissionLifecycle(submission).label;
      const digest = document.createElement("p");
      digest.className = "submission-digest";
      digest.textContent = `SHA-256 ${submission.digest}`;
      item.append(link, state, digest);
      fragment.append(item);
    }
    if (!body.submissions.length) {
      const empty = document.createElement("li");
      empty.className = "submission-empty";
      const heading = document.createElement("h3");
      heading.textContent = "Your first release starts here.";
      const guidance = document.createElement("p");
      guidance.textContent =
        "Build a tool, validate its archive, then submit it for review. Its exact version and progress will appear here.";
      const start = document.createElement("a");
      start.href = "/developers";
      start.textContent = "Get the developer tools ↗";
      empty.append(heading, guidance, start);
      fragment.append(empty);
    }
    list.replaceChildren(fragment);
    status.textContent = body.submissions.length
      ? `${body.submissions.length} recent submissions shown (up to 100). Open a version to follow its status.`
      : "No submissions yet. Build a tool and submit its validated archive.";
  } catch (error) {
    if (current !== generation || controller.signal.aborted) return;
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
