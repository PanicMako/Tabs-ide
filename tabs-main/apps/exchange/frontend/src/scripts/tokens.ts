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
function controls() {
  namespace.disabled = scope.value === "read";
  namespace.required = scope.value === "publish";
  create.disabled = !ready || busy || (scope.value === "publish" && !namespace.value);
}
function hide() {
  secret.value = "";
  section.hidden = true;
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
  try {
    await navigator.clipboard.writeText(secret.value);
    status.textContent = "Token copied. Clear it from your clipboard after use.";
  } catch {
    secret.focus();
    secret.select();
    status.textContent = "Clipboard unavailable. Copy the selected token manually.";
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
    item.textContent = `${token.label} · ${token.scope}${token.namespace ? ` (${token.namespace})` : ""} · ${revoked ? "revoked" : expired ? "expired" : `expires ${token.expires_at}`}`;
    if (!revoked && !expired) {
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.textContent = "Revoke";
      revoke.setAttribute("aria-label", `Revoke token ${token.label}`);
      revoke.addEventListener("click", async () => {
        revoke.disabled = true;
        try {
          await request(`/v1/tokens/${token.id}`, "DELETE");
          hide();
          await refresh();
          status.textContent = "Token revoked. Existing downloaded packages are not deleted.";
          document.querySelector<HTMLButtonElement>("#token-refresh")!.focus();
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : "Revocation failed.";
          revoke.disabled = false;
        }
      });
      item.append(" ", revoke);
    }
    list.append(item);
  }
  status.textContent = result.tokens.length
    ? `Showing ${result.tokens.length} recent tokens (maximum 100).`
    : "No tokens yet.";
}
document.querySelector("#token-refresh")!.addEventListener("click", () => {
  void refresh().catch((error: Error) => {
    status.textContent = error.message;
  });
});
document
  .querySelector<HTMLFormElement>("#token-create")!
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    if (create.disabled || busy) return;
    busy = true;
    controls();
    hide();
    try {
      const result = await request<{ token: string; expiresAt: string }>("/v1/tokens", "POST", {
        label: document.querySelector<HTMLInputElement>("#token-label")!.value,
        scope: scope.value,
        ...(scope.value === "publish" ? { namespace: namespace.value } : {}),
      });
      if (!/^tex_[A-Za-z0-9_-]{43}$/.test(result.token))
        throw new Error(
          "Unexpected token response. Refresh the list and revoke the newly created token before retrying.",
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
    `export TABS_EXCHANGE_ORIGIN='${location.origin}'\nexport TABS_EXCHANGE_TOKEN='<your-token>'\ntabsext search --registry "$TABS_EXCHANGE_ORIGIN"\n# Replace the quoted placeholders; use a publish-scoped token for:\ntabsext publish my-tool.tabsext --registry "$TABS_EXCHANGE_ORIGIN" --tabs-version '<your-tabs-version>'\nunset TABS_EXCHANGE_TOKEN`;
  ready = true;
  controls();
  await refresh();
}
void initialize().catch((error: Error) => {
  status.textContent = error.message;
});
