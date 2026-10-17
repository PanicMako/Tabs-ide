import { request, RegistryRequestError, type Actor, type Namespace } from "./api";

const content = document.getElementById("account-content")!;
const status = document.getElementById("account-status")!;
const signin = document.getElementById("account-signin")!;
const signinLink = document.getElementById("account-signin-link") as HTMLAnchorElement;
signinLink.href = `/auth/github/start?${new URLSearchParams({ returnTo: `${location.pathname}${location.search}` })}`;
let actor: Actor | null = null;
let generation = 0;
let lifetime = new AbortController();
let uncertainName: string | undefined;
const current = (version: number, signal: AbortSignal) => version === generation && !signal.aborted;
const form = document.getElementById("create-namespace") as HTMLFormElement | null;
const recovery = document.createElement("button");
recovery.type = "button";
recovery.className = "button secondary";
recovery.textContent = "Check namespace before retrying";
recovery.hidden = true;
form?.append(recovery);
function lock(locked: boolean) {
  for (const control of form?.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
    "input, button",
  ) ?? [])
    if (control !== recovery) control.disabled = locked;
}
function conceal() {
  actor = null;
  lock(true);
  content.hidden = true;
  signin.hidden = false;
}
const isPublishSection = content.dataset.accountSection === "publish";

async function namespaces(version: number, signal: AbortSignal) {
  const data = await request<{ namespaces: Namespace[] }>(
    "/v1/publisher/namespaces",
    "GET",
    undefined,
    signal,
  );
  if (!current(version, signal)) return undefined;
  if (
    !Array.isArray(data?.namespaces) ||
    data.namespaces.length > 100 ||
    data.namespaces.some(
      (item) =>
        !item ||
        typeof item.name !== "string" ||
        !/^[a-z][a-z0-9-]{1,62}$/.test(item.name) ||
        !["owner", "contributor"].includes(item.role) ||
        typeof item.verified !== "boolean",
    )
  )
    throw new Error("Namespace information is invalid. Check access before trying again.");
  const list = document.getElementById("account-namespaces")!;
  list.replaceChildren();
  if (!data.namespaces.length) {
    const item = document.createElement("li");
    item.textContent =
      "No namespaces yet. Create one when publishing is enabled, or accept an invitation from an existing owner.";
    list.append(item);
  }
  for (const namespace of data.namespaces) {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    name.className = "namespace-record-name";
    name.textContent = namespace.name;
    const access = document.createElement("span");
    access.className = "namespace-record-access";
    access.textContent = ` · ${namespace.role}`;
    const verification = document.createElement("span");
    verification.className = "namespace-record-verification";
    verification.textContent = ` · ${namespace.verified ? "verified publisher" : "not verified"}`;
    item.append(name, access, verification);
    list.append(item);
  }
  return data.namespaces;
}

async function init() {
  const version = ++generation;
  lifetime.abort();
  lifetime = new AbortController();
  const { signal } = lifetime;
  actor = null;
  recovery.disabled = false;
  lock(true);
  delete status.dataset.state;
  status.textContent = "Checking your account…";
  try {
    const fresh = await request<Actor | null>("/v1/me", "GET", undefined, signal);
    if (!current(version, signal)) return;
    if (
      fresh &&
      (typeof fresh.login !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(fresh.login) ||
        typeof fresh.publishingEnabled !== "boolean" ||
        typeof fresh.termsVersion !== "string" ||
        !fresh.termsVersion ||
        fresh.termsVersion.length > 100)
    )
      throw new Error("Account information is invalid. Publishing controls remain locked.");
    actor = fresh;
    if (!actor) {
      signin.hidden = false;
      if (!isPublishSection) {
        content.hidden = true;
      } else {
        content.hidden = false;
      }
      status.textContent = isPublishSection
        ? "Sign in to submit a package. Publishing controls remain disabled until prerequisites are confirmed."
        : "Sign-in required.";
      return;
    }
    if (document.getElementById("account-namespaces")) await namespaces(version, signal);
    if (!current(version, signal)) return;
    signin.hidden = true;
    content.hidden = false;
    const identity = document.getElementById("account-identity");
    if (identity) identity.textContent = `Signed in as ${actor.login}.`;
    const availability = document.getElementById("publishing-availability");
    if (availability)
      availability.textContent = actor.publishingEnabled
        ? "This instance accepts submissions. Every version still requires review and signed publication."
        : "You’re signed in, but publishing is turned off for this registry. Creating namespaces, uploading extensions, and inviting collaborators are unavailable. The registry operator must enable publishing after setup is complete. Existing memberships are still visible.";
    if (form) {
      for (const control of form.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
        "input, button",
      ))
        if (control !== recovery) control.disabled = !actor.publishingEnabled || !!uncertainName;
      form.addEventListener(
        "submit",
        async (event) => {
          event.preventDefault();
          delete status.dataset.state;
          const button = form.querySelector("button")!;
          const agreement = document.getElementById("accept-terms") as HTMLInputElement;
          if (
            button.disabled ||
            !actor?.publishingEnabled ||
            !agreement.checked ||
            !form.checkValidity()
          )
            return;
          const controls = [
            ...form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button"),
          ].filter((control) => control !== recovery);
          const name = (document.getElementById("new-namespace") as HTMLInputElement).value;
          const acceptedTerms = actor.termsVersion;
          const restoreFocus = form.contains(document.activeElement);
          uncertainName = name;
          for (const control of controls) control.disabled = true;
          try {
            await request(
              "/v1/namespaces",
              "POST",
              {
                name,
                acceptTermsVersion: acceptedTerms,
              },
              signal,
            );
            if (!current(version, signal)) return;
            uncertainName = undefined;
            form.reset();
            await namespaces(version, signal);
            if (!current(version, signal)) return;
            status.textContent = "Namespace created. Ownership is not yet verified.";
          } catch (error) {
            if (!current(version, signal)) return;
            recovery.hidden = !uncertainName;
            status.textContent =
              error instanceof Error ? error.message : "Namespace creation failed.";
            if (uncertainName) {
              status.textContent += " The result needs checking before another creation request.";
              if (
                restoreFocus &&
                (document.activeElement === document.body || form.contains(document.activeElement))
              )
                recovery.focus();
            }
            if (error instanceof RegistryRequestError && [401, 403].includes(error.status)) {
              conceal();
              signinLink.focus();
            }
          } finally {
            if (current(version, signal)) {
              lock(!actor?.publishingEnabled || !!uncertainName);
              if (
                restoreFocus &&
                !uncertainName &&
                (document.activeElement === document.body || form.contains(document.activeElement))
              )
                button.focus();
            }
          }
        },
        { signal },
      );
      recovery.hidden = !uncertainName;
      recovery.addEventListener(
        "click",
        async () => {
          if (recovery.disabled || !uncertainName) return;
          const name = uncertainName;
          recovery.disabled = true;
          status.textContent = "Checking current account and namespaces…";
          try {
            const fresh = await request<Actor | null>("/v1/me", "GET", undefined, signal);
            if (!current(version, signal)) return;
            if (!fresh)
              throw new RegistryRequestError(
                401,
                "AUTHENTICATION_REQUIRED",
                "Sign in to check your namespace.",
              );
            actor = fresh;
            const entries = await namespaces(version, signal);
            if (!current(version, signal) || !entries) return;
            const existing = entries.find((item) => item.name === name);
            if (existing && existing.role !== "owner")
              throw new Error(
                "Ownership could not be confirmed. Keep creation locked and ask the operator to check.",
              );
            uncertainName = undefined;
            recovery.hidden = true;
            if (existing) form.reset();
            lock(!actor.publishingEnabled);
            status.textContent = existing
              ? "The namespace exists and you are its owner. No second creation request was sent."
              : "No matching namespace membership was found. You can retry creation if publishing is enabled.";
            form.querySelector<HTMLInputElement>("#new-namespace")?.focus();
          } catch (error) {
            if (!current(version, signal)) return;
            status.textContent =
              error instanceof Error
                ? error.message
                : "Namespace verification failed. Creation remains locked.";
            if (error instanceof RegistryRequestError && [401, 403].includes(error.status)) {
              conceal();
              signinLink.focus();
            }
          } finally {
            if (current(version, signal)) recovery.disabled = false;
          }
        },
        { signal },
      );
    }
    if (!current(version, signal)) return;
    if (uncertainName)
      status.textContent =
        "The previous creation result needs checking. Check namespaces before retrying.";
    else {
      status.textContent = "Account loaded.";
      status.dataset.state = "ready";
    }
  } catch (error) {
    if (!current(version, signal)) return;
    lock(true);
    document.getElementById("account-namespaces")?.replaceChildren();
    if (!isPublishSection) content.hidden = true;
    if (error instanceof RegistryRequestError && [401, 403].includes(error.status)) conceal();
    if (
      error instanceof RegistryRequestError &&
      (error.status === 404 || error.code === "INVALID_RESPONSE")
    ) {
      status.textContent = isPublishSection
        ? "The registry account API is unavailable. Publishing remains disabled until this site can reach its registry API."
        : "The registry account API is unavailable at this address. A static website preview cannot sign in with GitHub. Open the configured Exchange server; its operator must configure GitHub OAuth and the callback URL.";
      signin.hidden = true;
      if (isPublishSection) {
        content.hidden = false;
      }
      return;
    }
    status.textContent = error instanceof Error ? error.message : "Account could not be loaded.";
    if (isPublishSection) {
      content.hidden = false;
    } else {
      signin.hidden = false;
    }
  }
}
window.addEventListener("pagehide", () => {
  generation++;
  lifetime.abort();
  actor = null;
  lock(true);
  document.getElementById("account-namespaces")?.replaceChildren();
  if (!isPublishSection) content.hidden = true;
  delete status.dataset.state;
  status.textContent = "Checking account access is required.";
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) void init();
});
void init();
