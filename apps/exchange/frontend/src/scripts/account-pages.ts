import {
  canManageNamespaces,
  request,
  RegistryRequestError,
  type Actor,
  type Namespace,
} from "./api";

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
(form?.querySelector(".identity-form-actions") ?? form)?.append(recovery);
const creationStatus = document.getElementById("namespace-feedback") ?? status;
const ready = document.getElementById("namespace-ready");
const createAnother = document.getElementById("namespace-create-another");
function feedback(message: string, state: "pending" | "error" | "success" = "pending") {
  if (creationStatus === status) delete status.dataset.state;
  creationStatus.textContent = message;
  creationStatus.dataset.state = state;
}
function showReady(name: string, moveFocus = false) {
  if (!ready || !form) return;
  const message = document.getElementById("namespace-ready-message");
  if (message)
    message.textContent = `Your publisher namespace is ${name}. For example, an extension named Relay would be ${name}.relay.`;
  const availability = document.getElementById("namespace-ready-availability");
  if (availability)
    availability.textContent = actor?.publishingEnabled
      ? "When your package is ready, submit it for review. Approval and signed publication are required before installation."
      : "You can build your extension now. Exchange uploads are not open yet, so marketplace submission comes later.";
  ready.hidden = false;
  form.hidden = true;
  const cardHeading = document.querySelector<HTMLElement>(
    ".identity-form-card .publisher-card-heading",
  );
  if (cardHeading) cardHeading.hidden = true;
  const heading = document.getElementById("new-namespace-heading");
  if (heading) heading.textContent = "Your publisher is ready.";
  const introduction = document.querySelector<HTMLElement>(
    ".identity-form-card .card-introduction",
  );
  if (introduction) introduction.hidden = true;
  if (moveFocus) ready.focus();
}
createAnother?.addEventListener("click", () => {
  if (!ready || !form) return;
  ready.hidden = true;
  form.hidden = false;
  const cardHeading = document.querySelector<HTMLElement>(
    ".identity-form-card .publisher-card-heading",
  );
  if (cardHeading) cardHeading.hidden = false;
  const heading = document.getElementById("new-namespace-heading");
  if (heading) heading.textContent = "Create another publisher namespace";
  feedback("");
  form.querySelector<HTMLInputElement>("#new-namespace")?.focus();
});
function lock(locked: boolean) {
  for (const control of form?.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
    "input, button",
  ) ?? [])
    if (control !== recovery) control.disabled = locked;
}
function conceal() {
  actor = null;
  delete status.dataset.state;
  if (ready) ready.hidden = true;
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
    item.textContent = "Your first publisher namespace will appear here.";
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
    verification.textContent = namespace.verified ? " · ✓ Verified publisher" : "";
    item.append(name, access, verification);
    list.append(item);
  }
  for (const step of document.querySelectorAll<HTMLElement>(
    '[data-publisher-setup-step="identity"]',
  )) {
    step.dataset.complete = String(data.namespaces.length > 0);
    const label = step.querySelector("[data-step-description]");
    if (label) label.textContent = data.namespaces.length ? "Identity ready" : "Identity & team";
  }
  const nextAction = document.getElementById("publisher-next-action") as HTMLAnchorElement | null;
  if (nextAction && data.namespaces.length) {
    nextAction.href = "/developers";
    nextAction.textContent = "Build your extension ↗";
  }
  return data.namespaces;
}

async function init() {
  const version = ++generation;
  lifetime.abort();
  lifetime = new AbortController();
  const { signal } = lifetime;
  actor = null;
  if (ready) ready.hidden = true;
  if (form) form.hidden = false;
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
        (fresh.namespaceManagementEnabled !== undefined &&
          typeof fresh.namespaceManagementEnabled !== "boolean") ||
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
    const memberships = document.getElementById("account-namespaces")
      ? await namespaces(version, signal)
      : undefined;
    if (!current(version, signal)) return;
    signin.hidden = true;
    content.hidden = false;
    const identity = document.getElementById("account-identity");
    if (identity) identity.textContent = `Signed in as ${actor.login}.`;
    const availability = document.getElementById("publishing-availability");
    if (availability)
      availability.textContent = canManageNamespaces(actor)
        ? actor.publishingEnabled
          ? "Create your namespace and manage your team. Extension uploads still require review and signed publication."
          : "Publisher setup is open. You can create a name and add your team; extension uploads are not open yet."
        : "Namespace setup is unavailable on this registry. Existing memberships remain visible; contact the registry operator to enable account setup.";
    const ownedNamespace = memberships?.find((entry) => entry.role === "owner");
    if (ownedNamespace && !uncertainName) showReady(ownedNamespace.name);
    if (form) {
      for (const control of form.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
        "input, button",
      ))
        if (control !== recovery) control.disabled = !canManageNamespaces(actor) || !!uncertainName;
      form.addEventListener(
        "submit",
        async (event) => {
          event.preventDefault();
          const button = form.querySelector("button")!;
          const agreement = document.getElementById("accept-terms") as HTMLInputElement;
          if (button.disabled || !actor || !canManageNamespaces(actor)) return;
          const nameInput = document.getElementById("new-namespace") as HTMLInputElement;
          const name = nameInput.value.trim().toLowerCase();
          nameInput.value = name;
          nameInput.dispatchEvent(new Event("input"));
          if (!/^[a-z][a-z0-9-]{1,62}$/.test(name)) {
            nameInput.setAttribute("aria-invalid", "true");
            feedback(
              "Choose 2–63 letters, numbers or hyphens, starting with a letter. For example: panicmako.",
              "error",
            );
            nameInput.focus();
            return;
          }
          nameInput.removeAttribute("aria-invalid");
          if (!agreement.checked) {
            feedback(
              "Read and accept the publisher terms before creating your namespace.",
              "error",
            );
            agreement.focus();
            return;
          }
          const controls = [
            ...form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button"),
          ].filter((control) => control !== recovery);
          const acceptedTerms = actor.termsVersion;
          const restoreFocus = form.contains(document.activeElement);
          uncertainName = name;
          feedback(`Creating ${name}… Keep this page open while we confirm it.`);
          form.setAttribute("aria-busy", "true");
          button.textContent = "Creating namespace…";
          for (const control of controls) control.disabled = true;
          let creationAcknowledged = false;
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
            creationAcknowledged = true;
            const entries = await namespaces(version, signal);
            if (!current(version, signal)) return;
            if (!entries?.some((entry) => entry.name === name && entry.role === "owner"))
              throw new Error(
                "The creation response arrived, but we could not confirm your ownership yet.",
              );
            uncertainName = undefined;
            form.reset();
            nameInput.dispatchEvent(new Event("input"));
            feedback(
              `Namespace created: ${name}. Next, build your extension. Ownership is not yet verified.`,
              "success",
            );
            showReady(name, restoreFocus);
            window.dispatchEvent(new Event("exchange:namespaces-changed"));
          } catch (error) {
            if (!current(version, signal)) return;
            const rejected =
              !creationAcknowledged &&
              error instanceof RegistryRequestError &&
              [400, 409, 422].includes(error.status);
            if (rejected) uncertainName = undefined;
            recovery.hidden = !uncertainName;
            const message = error instanceof Error ? error.message : "Namespace creation failed.";
            feedback(
              rejected
                ? error.status === 409
                  ? "That namespace is already in use. Choose another name, or check Your namespaces if you created it earlier."
                  : `The registry rejected this request. Check your name and the current publisher terms, then try again. ${message}`
                : `${message} We haven’t confirmed whether ${name} was created. Choose “Check namespace before retrying”; this checks safely without creating it again.`,
              "error",
            );
            if (uncertainName) {
              if (
                restoreFocus &&
                (document.activeElement === document.body || form.contains(document.activeElement))
              )
                recovery.focus();
            }
            if (error instanceof RegistryRequestError && [401, 403].includes(error.status)) {
              conceal();
              status.textContent = message;
              signinLink.focus();
            }
          } finally {
            if (current(version, signal)) {
              form.removeAttribute("aria-busy");
              button.textContent = "Create namespace ↗";
              lock(!canManageNamespaces(actor) || !!uncertainName);
              if (
                restoreFocus &&
                !uncertainName &&
                !form.hidden &&
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
          feedback("Checking your account and namespace… No new namespace will be created.");
          recovery.textContent = "Checking namespace…";
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
            if (existing) {
              form.reset();
              window.dispatchEvent(new Event("exchange:namespaces-changed"));
            }
            lock(!canManageNamespaces(actor));
            feedback(
              existing
                ? "The namespace exists and you are its owner. No second creation request was sent. Next, build your extension."
                : "No matching namespace membership was found. You can retry creation if namespace management is enabled.",
              existing ? "success" : "pending",
            );
            if (existing) showReady(name, true);
            else form.querySelector<HTMLInputElement>("#new-namespace")?.focus();
          } catch (error) {
            if (!current(version, signal)) return;
            feedback(
              error instanceof Error
                ? error.message
                : "Namespace verification failed. Creation remains locked.",
              "error",
            );
            if (error instanceof RegistryRequestError && [401, 403].includes(error.status)) {
              conceal();
              signinLink.focus();
            }
          } finally {
            if (current(version, signal)) {
              recovery.disabled = false;
              recovery.textContent = "Check namespace before retrying";
            }
          }
        },
        { signal },
      );
    }
    if (!current(version, signal)) return;
    if (uncertainName)
      feedback(
        "The previous creation result needs checking. Check namespaces before retrying.",
        "error",
      );
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
