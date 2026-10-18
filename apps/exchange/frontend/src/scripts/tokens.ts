import { request, type Actor, type Namespace } from "./api";

interface Token {
  id: string;
  label: string;
  scope: string;
  namespace: string | null;
  expires_at: string;
  revoked_at: string | null;
}
const status = document.querySelector<HTMLElement>("#token-status")!;
const list = document.querySelector<HTMLElement>("#token-list")!;
const scope = document.querySelector<HTMLSelectElement>("#token-scope")!;
const namespace = document.querySelector<HTMLSelectElement>("#token-namespace")!;
const create = document.querySelector<HTMLButtonElement>("#token-create-button")!;
const secret = document.querySelector<HTMLInputElement>("#token-secret")!;
const section = document.querySelector<HTMLElement>("#token-secret-section")!;
let ready = false;
let busy = false;
let revealGeneration = 0;
function controls() {
  namespace.disabled = busy || scope.value === "read";
  scope.disabled = busy;
  const label = document.querySelector<HTMLInputElement>("#token-label");
  if (label) label.disabled = busy;
  const namespaceField = document.getElementById("token-namespace-field");
  if (namespaceField) namespaceField.hidden = scope.value === "read";
  const empty = document.getElementById("token-namespace-empty");
  if (empty) empty.hidden = namespace.options.length > 0;
  const help = document.getElementById("token-scope-help");
  if (help)
    help.textContent =
      scope.value === "read"
        ? "Browse the private catalog and download signed packages. This cannot submit packages."
        : "Submit packages for one publisher. Scanning and review still apply.";
  create.textContent = busy ? "Creating token…" : "Create token";
  namespace.required = scope.value === "publish";
  create.disabled = !ready || busy || (scope.value === "publish" && !namespace.value);
}
function hide() {
  revealGeneration++;
  secret.value = "";
  section.hidden = true;
  const feedback = document.getElementById("token-secret-feedback");
  if (feedback) feedback.textContent = "";
}
scope.addEventListener("change", controls);
namespace.addEventListener("change", controls);
document.querySelector("#token-hide")!.addEventListener("click", () => {
  hide();
  create.focus();
});
window.addEventListener("pagehide", hide);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hide();
});
document.querySelector("#token-copy")!.addEventListener("click", async () => {
  if (section.hidden || !secret.value) return;
  const feedback = document.getElementById("token-secret-feedback") ?? status;
  try {
    await navigator.clipboard.writeText(secret.value);
    feedback.textContent = "Token copied. Clear it from your clipboard after use.";
  } catch {
    secret.focus();
    secret.select();
    feedback.textContent = "Clipboard unavailable. Copy the selected token manually.";
  }
});
async function refresh() {
  const result = await request<{ tokens: Token[] }>("/v1/tokens");
  list.replaceChildren();
  for (const token of result.tokens) {
    if (!/^[0-9a-f-]{36}$/.test(token.id)) continue;
    const item = document.createElement("li");
    const revoked = Boolean(token.revoked_at);
    const expired = Date.parse(token.expires_at) <= Date.now();
    const details = document.createElement("div");
    details.className = "cli-token-details";
    const name = document.createElement("strong");
    name.textContent = token.label;
    const access = document.createElement("p");
    access.textContent =
      token.scope === "publish"
        ? `Submission access · ${token.namespace ?? "No namespace"}`
        : "Read access · Private catalog and signed downloads";
    const expiry = document.createElement("p");
    const timestamp = Date.parse(token.expires_at);
    const date = Number.isFinite(timestamp)
      ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(timestamp)
      : "Unknown expiry";
    expiry.textContent = `${expired ? "Expired" : "Expires"} ${date}`;
    expiry.title = token.expires_at;
    const badge = document.createElement("span");
    badge.className = "cli-token-state";
    badge.dataset.state = revoked ? "revoked" : expired ? "expired" : "active";
    badge.textContent = revoked ? "Revoked" : expired ? "Expired" : "Active";
    details.append(name, access, expiry);
    item.append(details, badge);
    if (!revoked && !expired) {
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.textContent = "Revoke";
      revoke.setAttribute("aria-label", `Revoke token ${token.label}`);
      const confirmation = document.createElement("div");
      confirmation.className = "cli-revoke-confirmation";
      confirmation.hidden = true;
      const explanation = document.createElement("p");
      explanation.textContent = `Revoke “${token.label}”? Tools using this token will lose access. You can create a new token later.`;
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "button secondary";
      cancel.textContent = "Keep token";
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.className = "button cli-revoke-action";
      confirm.textContent = "Revoke token";
      confirmation.append(explanation, cancel, confirm);
      revoke.className = "button secondary";
      revoke.addEventListener("click", () => {
        confirmation.hidden = false;
        revoke.hidden = true;
        cancel.focus();
      });
      const dismiss = () => {
        confirmation.hidden = true;
        revoke.hidden = false;
        revoke.focus();
      };
      cancel.addEventListener("click", dismiss);
      confirmation.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !confirm.disabled) dismiss();
      });
      confirm.addEventListener("click", async () => {
        const feedback = document.getElementById("token-list-feedback") ?? status;
        confirm.disabled = true;
        cancel.disabled = true;
        try {
          await request(`/v1/tokens/${token.id}`, "DELETE");
          hide();
          await refresh();
          feedback.textContent = "Token revoked. Existing downloaded packages are not deleted.";
          document.querySelector<HTMLButtonElement>("#token-refresh")!.focus();
        } catch (error) {
          feedback.textContent = error instanceof Error ? error.message : "Revocation failed.";
          confirm.disabled = false;
          cancel.disabled = false;
        }
      });
      item.append(revoke, confirmation);
    }
    list.append(item);
  }
  const count = document.getElementById("token-count");
  if (count) count.textContent = String(list.children.length);
  if (!list.children.length) {
    const empty = document.createElement("li");
    empty.className = "cli-token-empty";
    const title = document.createElement("strong");
    title.textContent = "No tokens yet. Nothing to manage.";
    const help = document.createElement("p");
    help.textContent = "Create one above when you’re ready to connect a terminal or automation.";
    empty.append(title, help);
    list.append(empty);
  }
  const feedback = document.getElementById("token-list-feedback") ?? status;
  feedback.textContent = result.tokens.length
    ? `Showing ${result.tokens.length} recent tokens (maximum 100).`
    : "No tokens yet.";
  if (status.textContent === "Loading your access…") status.textContent = "";
}
document.querySelector("#token-refresh")!.addEventListener("click", () => {
  void refresh().catch((error: Error) => {
    status.textContent = error.message;
    const feedback = document.getElementById("token-list-feedback");
    if (feedback) feedback.textContent = error.message;
  });
});
document
  .querySelector<HTMLFormElement>("#token-create")!
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    if (create.disabled || busy) return;
    const label = document.querySelector<HTMLInputElement>("#token-label")!;
    if (!label.value.trim() || label.value.trim().length > 100) {
      status.textContent = "Give this token a name between 1 and 100 characters.";
      label.setAttribute("aria-invalid", "true");
      label.focus();
      return;
    }
    label.removeAttribute("aria-invalid");
    busy = true;
    controls();
    hide();
    const currentReveal = revealGeneration;
    try {
      const result = await request<{ token: string; expiresAt: string }>("/v1/tokens", "POST", {
        label: label.value.trim(),
        scope: scope.value,
        ...(scope.value === "publish" ? { namespace: namespace.value } : {}),
      });
      if (!/^tex_[A-Za-z0-9_-]{43}$/.test(result.token))
        throw new Error(
          "Unexpected token response. Refresh the list and revoke the newly created token before retrying.",
        );
      if (currentReveal !== revealGeneration || document.hidden)
        throw new Error(
          "A token was created while this page was hidden. Its secret was not displayed. Refresh the token list and revoke it before creating another.",
        );
      secret.value = result.token;
      section.hidden = false;
      document.querySelector("#token-expiry")!.textContent = `Expires ${result.expiresAt}.`;
      document.querySelector<HTMLElement>("#token-secret-title")!.focus();
      await refresh();
      status.textContent = "Token created. Save its secret now; it cannot be retrieved again.";
    } catch (error) {
      status.textContent = `${error instanceof Error ? error.message : "Creation failed."} If the outcome is uncertain, refresh the token list before creating another.`;
    } finally {
      busy = false;
      controls();
    }
  });
async function initialize() {
  const actor = await request<Actor | null>("/v1/me");
  if (!actor) {
    status.textContent = "Sign in to manage tokens.";
    return;
  }
  const result = await request<{ namespaces: Namespace[] }>("/v1/publisher/namespaces");
  for (const entry of result.namespaces) {
    const option = document.createElement("option");
    option.value = entry.name;
    option.textContent = entry.name;
    namespace.append(option);
  }
  document.querySelector("#token-instructions")!.textContent =
    `export TABS_EXCHANGE_ORIGIN='${location.origin}'\nexport TABS_EXCHANGE_TOKEN='<your-token>'`;
  ready = true;
  controls();
  await refresh();
}
void initialize().catch((error: Error) => {
  status.textContent = error.message;
});

document.getElementById("token-setup-copy")?.addEventListener("click", async () => {
  const feedback = document.getElementById("token-setup-feedback");
  try {
    await navigator.clipboard.writeText(
      document.getElementById("token-instructions")!.textContent ?? "",
    );
    if (feedback)
      feedback.textContent = "Setup copied. Replace <your-token> with your saved secret.";
  } catch {
    if (feedback)
      feedback.textContent = "Copy unavailable. Select the setup commands and copy them manually.";
  }
});
