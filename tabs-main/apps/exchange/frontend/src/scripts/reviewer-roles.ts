import { request, RegistryRequestError, type Actor } from "./api";

interface RoleChange {
  login: string;
  action: string;
  reason: string;
}
interface History {
  reviewers: {
    login: string;
    active: boolean;
    reason: string;
    changed_by: string;
    changed_at: string;
  }[];
  events: { login: string; actor: string; action: string; reason: string; created_at: string }[];
}
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = element("roles-status");
const content = element("roles-content");
const form = element<HTMLFormElement>("roles-form");
const fields = element<HTMLFieldSetElement>("roles-fields");
const confirmation = element("roles-confirmation");
const confirm = element<HTMLButtonElement>("roles-confirm");
const cancel = element<HTMLButtonElement>("roles-cancel");
const refresh = element<HTMLButtonElement>("roles-refresh");
const prepare = element<HTMLButtonElement>("roles-prepare");
const endpoint = "/v1/operator/reviewers";
const lifecycle = new AbortController();
let pending: AbortController | undefined;
let generation = 0;
let change: RoleChange | undefined;
let busy = false;

function resetConfirmation(restoreFocus = false) {
  change = undefined;
  confirmation.hidden = true;
  fields.disabled = false;
  if (restoreFocus) prepare.focus();
}
function renderHistory(data: History) {
  const assignments = element("roles-assignments");
  const events = element("roles-events");
  assignments.replaceChildren();
  events.replaceChildren();
  for (const row of data.reviewers) {
    const item = document.createElement("li");
    item.textContent = `${row.login}: ${row.active ? "Reviewer" : "Access revoked"}. Changed by ${row.changed_by} at ${row.changed_at}. Reason: ${row.reason}`;
    assignments.append(item);
  }
  for (const row of data.events) {
    const item = document.createElement("li");
    item.textContent = `${row.action} — ${row.login}, by ${row.actor} at ${row.created_at}. Reason: ${row.reason}`;
    events.append(item);
  }
  if (!data.reviewers.length) assignments.textContent = "No delegated reviewer assignments.";
  if (!data.events.length) events.textContent = "No delegation events recorded.";
}
async function load() {
  if (busy) return;
  const current = ++generation;
  pending?.abort();
  pending = new AbortController();
  const signal = pending.signal;
  resetConfirmation();
  content.hidden = true;
  element("roles-signin").hidden = true;
  status.textContent = "Checking operator access…";
  try {
    const actor = await request<Actor | null>("/v1/me", "GET", undefined, signal);
    if (current !== generation) return;
    if (!actor?.operator) {
      status.textContent =
        "An explicitly configured operator account is required. Publisher or reviewer access is not sufficient.";
      element("roles-signin").hidden = Boolean(actor);
      return;
    }
    const history = await request<History>(endpoint, "GET", undefined, signal);
    if (current !== generation) return;
    renderHistory(history);
    element("roles-identity").textContent = `Signed in as ${actor.login} · Operator`;
    content.hidden = false;
    status.textContent = "Reviewer access and audit history loaded.";
  } catch (error) {
    if (current !== generation || signal.aborted) return;
    if (error instanceof RegistryRequestError && (error.status === 401 || error.status === 403))
      element("roles-signin").hidden = false;
    status.textContent =
      error instanceof RegistryRequestError
        ? error.message
        : "Access could not be checked. Reload this page to retry.";
  }
}
form.addEventListener(
  "submit",
  (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    change = {
      login: element<HTMLInputElement>("roles-login").value,
      action: element<HTMLSelectElement>("roles-action").value,
      reason: element<HTMLTextAreaElement>("roles-reason").value.trim(),
    };
    if (!change.reason) {
      status.textContent = "Enter a reason for this access change.";
      return;
    }
    element("roles-summary").textContent =
      `${change.action === "grant" ? "Grant reviewer access to" : "Revoke reviewer access from"} ${change.login}. Reason: ${change.reason}`;
    fields.disabled = true;
    confirmation.hidden = false;
    confirmation.focus();
  },
  { signal: lifecycle.signal },
);
cancel.addEventListener("click", () => resetConfirmation(true), { signal: lifecycle.signal });
confirmation.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Escape" && !busy) resetConfirmation(true);
  },
  { signal: lifecycle.signal },
);
confirm.addEventListener(
  "click",
  async () => {
    if (busy || !change) return;
    busy = true;
    confirm.disabled = cancel.disabled = refresh.disabled = true;
    status.textContent = "Recording access change…";
    try {
      const result = await request<{ changed: boolean }>(
        endpoint,
        "POST",
        change,
        lifecycle.signal,
      );
      const history = await request<History>(endpoint, "GET", undefined, lifecycle.signal);
      renderHistory(history);
      status.textContent = result.changed
        ? "Access change recorded and audit history refreshed."
        : "The requested access was already set. No duplicate change was recorded.";
    } catch (error) {
      if (lifecycle.signal.aborted) return;
      if (error instanceof RegistryRequestError && (error.status === 401 || error.status === 403)) {
        content.hidden = true;
        status.textContent =
          "Operator access expired or was removed. Sign in again with an authorized operator.";
        element("roles-signin").hidden = false;
        element("roles-signin").focus();
      } else if (error instanceof RegistryRequestError && error.status === 400) {
        status.textContent = error.message;
      } else {
        status.textContent =
          "The change could not be confirmed. It may have been accepted. Refresh assignments and audit history before preparing another change; no automatic retry was made.";
      }
    } finally {
      busy = false;
      confirm.disabled = cancel.disabled = refresh.disabled = false;
      resetConfirmation(!content.hidden);
    }
  },
  { signal: lifecycle.signal },
);
refresh.addEventListener("click", () => void load(), { signal: lifecycle.signal });
window.addEventListener(
  "pagehide",
  (event) => {
    generation++;
    pending?.abort();
    if (!event.persisted) lifecycle.abort();
  },
  { signal: lifecycle.signal },
);
window.addEventListener(
  "pageshow",
  (event) => {
    if (event.persisted) void load();
  },
  { signal: lifecycle.signal },
);
void load();
