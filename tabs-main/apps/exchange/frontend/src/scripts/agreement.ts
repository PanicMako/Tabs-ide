import { request, type Actor } from "./api";
interface Agreement {
  termsVersion: string;
  acceptedAt: string | null;
}
async function initialize() {
  const actor = await request<Actor | null>("/v1/me");
  if (!actor) return;
  const section = document.createElement("section");
  section.className = "card";
  const title = document.createElement("h2");
  title.textContent = "Publisher agreement";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const form = document.createElement("form");
  const label = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.required = true;
  const terms = document.createElement("a");
  terms.href = "/publisher-terms";
  terms.textContent = "this registry's publisher terms";
  label.append(checkbox, " I have read and accept ", terms, ".");
  const accept = document.createElement("button");
  accept.type = "submit";
  accept.textContent = "Accept current terms";
  accept.disabled = true;
  form.append(label, accept);
  section.append(title, status, form);
  document.querySelector("#account-content")!.append(section);
  let current: Agreement | undefined;
  let busy = false;
  function update() {
    accept.disabled =
      busy ||
      !current ||
      Boolean(current.acceptedAt) ||
      !checkbox.checked ||
      !actor!.publishingEnabled;
  }
  async function load() {
    current = await request<Agreement>("/v1/publisher/agreement");
    status.textContent = current.acceptedAt
      ? `Terms ${current.termsVersion} accepted on ${current.acceptedAt}.`
      : `Terms ${current.termsVersion} must be accepted before browser or CLI uploads.${actor!.publishingEnabled ? "" : " Publishing and acceptance are currently disabled."}`;
    form.hidden = Boolean(current.acceptedAt);
    update();
  }
  checkbox.addEventListener("change", update);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (accept.disabled || !current) return;
    busy = true;
    update();
    try {
      await request("/v1/publisher/agreement", "POST", {
        acceptTermsVersion: current.termsVersion,
      });
      await load();
      status.setAttribute("tabindex", "-1");
      status.focus();
    } catch (error) {
      status.textContent =
        error instanceof Error
          ? error.message
          : "Acceptance could not be confirmed. Reload to check your status.";
    } finally {
      busy = false;
      update();
    }
  });
  await load();
}
void initialize().catch((error: unknown) => {
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent =
    error instanceof Error ? error.message : "Agreement status could not load. Reload to retry.";
  document.querySelector("#account-content")!.append(status);
});
