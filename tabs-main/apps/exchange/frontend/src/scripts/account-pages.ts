import { request, RegistryRequestError, type Actor, type Namespace } from "./api";

const content = document.getElementById("account-content")!;
const status = document.getElementById("account-status")!;
const signin = document.getElementById("account-signin")!;
const signinLink = document.getElementById("account-signin-link") as HTMLAnchorElement;
signinLink.href = `/auth/github/start?${new URLSearchParams({ returnTo: `${location.pathname}${location.search}` })}`;
let actor: Actor | null = null;

async function namespaces() {
  const data = await request<{ namespaces: Namespace[] }>("/v1/publisher/namespaces");
  const list = document.getElementById("account-namespaces")!;
  list.replaceChildren();
  if (!data.namespaces.length) {
    const item = document.createElement("li");
    item.textContent = "No namespace memberships yet. Create one or ask an owner to invite you.";
    list.append(item);
  }
  for (const namespace of data.namespaces) {
    const item = document.createElement("li");
    item.textContent = `${namespace.name} · ${namespace.role} · ${namespace.verified ? "verified publisher" : "not verified"}`;
    list.append(item);
  }
}

async function init() {
  try {
    actor = await request<Actor | null>("/v1/me");
    if (!actor) {
      signin.hidden = false;
      status.textContent = "Sign-in required.";
      return;
    }
    content.hidden = false;
    const identity = document.getElementById("account-identity");
    if (identity) identity.textContent = `Signed in as ${actor.login}.`;
    const availability = document.getElementById("publishing-availability");
    if (availability)
      availability.textContent = actor.publishingEnabled
        ? "This instance accepts submissions. Every version still requires review and signed publication."
        : "Publishing is disabled on this instance. Existing memberships remain visible; new namespaces and submissions are unavailable.";
    const form = document.getElementById("create-namespace") as HTMLFormElement | null;
    if (form) {
      for (const control of form.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
        "input, button",
      ))
        control.disabled = !actor.publishingEnabled;
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = form.querySelector("button")!;
        button.disabled = true;
        try {
          await request("/v1/namespaces", "POST", {
            name: (document.getElementById("new-namespace") as HTMLInputElement).value,
            acceptTermsVersion: actor!.termsVersion,
          });
          form.reset();
          await namespaces();
          status.textContent = "Namespace created. Ownership is not yet verified.";
        } catch (error) {
          status.textContent =
            error instanceof Error ? error.message : "Namespace creation failed.";
        } finally {
          button.disabled = false;
        }
      });
    }
    if (document.getElementById("account-namespaces")) await namespaces();
    status.textContent = "Account loaded.";
  } catch (error) {
    if (
      error instanceof RegistryRequestError &&
      (error.status === 404 || error.code === "INVALID_RESPONSE")
    ) {
      status.textContent =
        "The registry account API is unavailable at this address. A static website preview cannot sign in with GitHub. Open the configured Exchange server; its operator must configure GitHub OAuth and the callback URL.";
      signin.hidden = true;
      return;
    }
    status.textContent = error instanceof Error ? error.message : "Account could not be loaded.";
    signin.hidden = false;
  }
}
void init();
