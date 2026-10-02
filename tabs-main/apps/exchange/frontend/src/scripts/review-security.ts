import { request, RegistryRequestError, type Actor } from "./api";
import {
  blockedDigestEvidence,
  digestBlock,
  digestBlockBatch,
  digestUnblock,
  namespaceVerification,
} from "../lib/reviewSecurity";

const status = document.getElementById("security-status")!;
const content = document.getElementById("security-content")!;
const signin = document.getElementById("security-signin")!;
const refresh = document.getElementById("security-refresh") as HTMLButtonElement;
const list = document.getElementById("security-blocked")!;
let generation = 0;
let pending: AbortController | undefined;
let busy = false;

function reconnect() {
  generation++;
  pending?.abort();
  content.hidden = true;
  list.replaceChildren();
  signin.hidden = false;
  status.textContent =
    "Reviewer access expired or was removed. Sign in with an authorized account.";
  refresh.disabled = false;
}
type Mutation = { path: string; body: unknown };
function bind(form: HTMLFormElement, prepare: (data: FormData) => Mutation, success: string) {
  const fields = form.querySelector("fieldset")!;
  const result = form.querySelector<HTMLElement>("[data-result]")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || fields.disabled || content.hidden) return;
    let mutation: Mutation;
    try {
      mutation = prepare(new FormData(form));
    } catch (error) {
      result.textContent = error instanceof Error ? error.message : "Check the form fields.";
      return;
    }
    const current = generation;
    busy = true;
    refresh.disabled = true;
    fields.disabled = true;
    result.textContent = "Recording audited change…";
    try {
      await request(mutation.path, "POST", mutation.body);
      if (current === generation)
        result.textContent = `${success} Refresh evidence before another action.`;
    } catch (error) {
      if (current !== generation) return;
      if (error instanceof RegistryRequestError && (error.status === 401 || error.status === 403))
        reconnect();
      else
        result.textContent =
          error instanceof RegistryRequestError && error.status < 500
            ? `${error.message} Refresh evidence before retrying.`
            : "The change could not be confirmed and may have been accepted. Refresh evidence and inspect audit records before retrying. No automatic retry was made.";
    } finally {
      busy = false;
      refresh.disabled = false;
      refresh.focus();
    }
  });
}
const value = (data: FormData, key: string) => String(data.get(key) ?? "");
bind(
  document.getElementById("security-verification") as HTMLFormElement,
  (data) =>
    namespaceVerification(
      value(data, "namespace"),
      data.has("verified"),
      value(data, "proof"),
      value(data, "reason"),
    ),
  "Verification decision recorded. This does not approve any release.",
);
bind(
  document.getElementById("security-block") as HTMLFormElement,
  (data) => digestBlock(value(data, "digest"), value(data, "reason")),
  "Digest blocked. Inspect affected releases and publish updated signed metadata promptly.",
);
bind(
  document.getElementById("security-batch") as HTMLFormElement,
  (data) => digestBlockBatch(value(data, "entries")),
  "Digest batch blocked. Inspect affected releases and publish updated signed metadata promptly.",
);

async function load() {
  if (busy) return;
  const current = ++generation;
  pending?.abort();
  const controller = new AbortController();
  pending = controller;
  content.hidden = true;
  list.replaceChildren();
  refresh.disabled = true;
  status.textContent = "Checking reviewer access and loading digest blocks…";
  try {
    const actor = await request<Actor | null>("/v1/me", "GET", undefined, controller.signal);
    if (current !== generation) return;
    signin.hidden = actor !== null;
    if (actor?.admin !== true) {
      status.textContent = actor
        ? "This account does not have reviewer access."
        : "Sign in with a reviewer account.";
      return;
    }
    const entries = blockedDigestEvidence(
      await request<unknown>("/v1/review/blocked-digests", "GET", undefined, controller.signal),
    );
    if (current !== generation) return;
    for (const entry of entries) {
      const item = document.createElement("li");
      const evidence = document.createElement("p");
      evidence.textContent = `SHA-256 ${entry.digest}. Reason: ${entry.reason}. Recorded: ${entry.createdAt}.`;
      const form = document.createElement("form");
      const fields = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = `Remove block for ${entry.digest}`;
      const label = document.createElement("label");
      label.textContent = "Removal reason ";
      const reason = document.createElement("textarea");
      reason.name = "reason";
      reason.required = true;
      reason.maxLength = 2000;
      label.append(reason);
      const confirmation = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.required = true;
      confirmation.append(checkbox, " I understand revoked releases remain revoked.");
      const button = document.createElement("button");
      button.type = "submit";
      button.textContent = "Remove this digest block";
      const result = document.createElement("p");
      result.setAttribute("role", "status");
      result.dataset.result = "";
      fields.append(legend, label, confirmation, button);
      form.append(fields, result);
      bind(
        form,
        (data) => digestUnblock(entry.digest, value(data, "reason")),
        "Block removed. Revoked releases remain revoked.",
      );
      item.append(evidence, form);
      list.append(item);
    }
    if (!entries.length) {
      const item = document.createElement("li");
      item.textContent = "No blocked digests returned.";
      list.append(item);
    }
    for (const fields of content.querySelectorAll("fieldset")) fields.disabled = false;
    for (const result of content.querySelectorAll("[data-result]")) result.textContent = "";
    content.hidden = false;
    status.textContent = `${entries.length} digest block(s) shown (maximum 500). Server authorization and audit recording apply to every change.`;
  } catch (error) {
    if (current === generation && !controller.signal.aborted) {
      if (error instanceof RegistryRequestError && (error.status === 401 || error.status === 403))
        reconnect();
      else
        status.textContent =
          "Security evidence could not be loaded. Refresh and check reviewer access; do not assume the blocklist is empty.";
    }
  } finally {
    if (current === generation) refresh.disabled = false;
  }
}
refresh.addEventListener("click", () => void load());
window.addEventListener("pagehide", () => {
  generation++;
  pending?.abort();
  content.hidden = true;
  list.replaceChildren();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) void load();
});
void load();
