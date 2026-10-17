import { request, RegistryRequestError, type Actor, type Namespace } from "./api";

let pending: AbortController | undefined;
let mountedSection: HTMLElement | undefined;
const host = () =>
  document.querySelector("#namespace-collaborators") ?? document.querySelector("#account-content");

async function initialize(signal: AbortSignal) {
  const actor = await request<Actor | null>("/v1/me", "GET", undefined, signal);
  if (signal.aborted) return;
  if (!actor) return;
  const result = await request<{ namespaces: Namespace[] }>(
    "/v1/publisher/namespaces",
    "GET",
    undefined,
    signal,
  );
  if (signal.aborted) return;
  const section = document.createElement("section");
  section.className = "card dashboard-task collaborator-desk";
  const heading = document.createElement("h2");
  heading.textContent = "Invite a collaborator";
  const guidance = document.createElement("p");
  guidance.textContent =
    "Invite someone who has signed in to this Exchange. Only namespace owners can invite; the recipient must accept.";
  const form = document.createElement("form");
  form.noValidate = true;
  const namespaceLabel = document.createElement("label");
  namespaceLabel.htmlFor = "invite-namespace";
  namespaceLabel.textContent = "Namespace you own";
  const namespace = document.createElement("select");
  namespace.id = "invite-namespace";
  namespace.required = true;
  let ownedNamespaces = result.namespaces.filter((entry) => entry.role === "owner");
  for (const entry of ownedNamespaces) {
    const option = document.createElement("option");
    option.value = entry.name;
    option.textContent = entry.name;
    namespace.append(option);
  }
  const loginLabel = document.createElement("label");
  loginLabel.htmlFor = "invite-login";
  loginLabel.textContent = "GitHub username";
  const login = document.createElement("input");
  login.id = "invite-login";
  login.required = true;
  login.maxLength = 39;
  login.pattern = "[a-zA-Z0-9][a-zA-Z0-9-]{0,38}";
  login.autocomplete = "off";
  login.placeholder = "GitHub username";
  const roleLabel = document.createElement("label");
  roleLabel.htmlFor = "invite-role";
  roleLabel.textContent = "Role";
  const role = document.createElement("select");
  role.id = "invite-role";
  for (const value of ["contributor", "owner"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent =
      value === "owner"
        ? "Owner — can manage members and ownership"
        : "Contributor — can submit extensions";
    role.append(option);
  }
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Send invitation";
  button.disabled = !actor.publishingEnabled || !namespace.options.length;
  const status = document.createElement("p");
  status.id = "collaborator-status";
  login.setAttribute("aria-describedby", status.id);
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  if (!namespace.options.length)
    status.textContent = "You must own a namespace to invite collaborators.";
  else if (!actor.publishingEnabled)
    status.textContent = "Invitations are disabled while publishing is unavailable.";
  form.className = "task-form";
  for (const [label, control] of [
    [namespaceLabel, namespace],
    [loginLabel, login],
    [roleLabel, role],
  ]) {
    const field = document.createElement("div");
    field.className = "form-field";
    field.append(label!, control!);
    form.append(field);
  }
  const actions = document.createElement("div");
  actions.className = "form-actions";
  button.className = "button";
  actions.append(button);
  form.append(actions);
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "button secondary";
  refresh.textContent = "Check access and pending invitations";
  refresh.hidden = true;
  const controls = [namespace, login, role, button];
  let busy = false;
  let uncertain: { namespace: string; login: string; role: string } | undefined;
  const lock = () =>
    controls.forEach((control) => {
      control.disabled = true;
    });
  const unlock = () =>
    controls.forEach((control) => {
      control.disabled = false;
    });
  if (button.disabled) {
    lock();
    form.hidden = true;
    guidance.textContent = !actor.publishingEnabled
      ? "Team invitations are unavailable while this registry has publishing turned off. No account changes are needed to fix this; the registry operator must finish enabling publishing."
      : "Create a namespace first. You can then invite other GitHub accounts to help manage its extensions.";
  }
  const reconnect = (error: unknown) => {
    if (!(error instanceof RegistryRequestError) || ![401, 403].includes(error.status))
      return false;
    const restore =
      section.contains(document.activeElement) || document.activeElement === document.body;
    const content = document.getElementById("account-content");
    if (content) content.hidden = true;
    const signin = document.getElementById("account-signin");
    if (signin) signin.hidden = false;
    const accountStatus = document.getElementById("account-status");
    if (accountStatus)
      accountStatus.textContent =
        "Invitation access expired or was removed. Sign in again and check namespace membership.";
    refresh.hidden = true;
    if (restore) document.getElementById("account-signin-link")?.focus();
    return true;
  };
  refresh.addEventListener("click", async () => {
    if (busy || !uncertain || signal.aborted) return;
    busy = true;
    refresh.disabled = true;
    const origin = document.activeElement;
    try {
      const freshActor = await request<Actor | null>("/v1/me", "GET", undefined, signal);
      const identities = await request<{ namespaces: Namespace[] }>(
        "/v1/publisher/namespaces",
        "GET",
        undefined,
        signal,
      );
      if (signal.aborted) return;
      if (
        !freshActor?.publishingEnabled ||
        !identities.namespaces.some(
          (entry) => entry.name === uncertain!.namespace && entry.role === "owner",
        )
      ) {
        status.textContent =
          "Invitations remain unavailable. Publishing must be enabled and you must still own this namespace. Reload after access is restored.";
        return;
      }
      const current = await request<{
        members: Array<{ login: string }>;
        invitations: Array<{ login: string }>;
      }>(`/v1/namespaces/${uncertain.namespace}/members`, "GET", undefined, signal);
      if (signal.aborted) return;
      if (
        !Array.isArray(current.members) ||
        !Array.isArray(current.invitations) ||
        [...current.members, ...current.invitations].some(
          (entry) => typeof entry?.login !== "string",
        )
      )
        throw new Error("Invitation history could not be verified.");
      const found = [...current.members, ...current.invitations].some(
        (entry) => entry.login.toLowerCase() === uncertain!.login.toLowerCase(),
      );
      status.textContent = found
        ? `${uncertain.login} already has membership or a pending invitation in ${uncertain.namespace}. No second invitation was sent. Check the members section below for the current role.`
        : `No membership or pending invitation for ${uncertain.login} was found in ${uncertain.namespace}. Access was checked again; you can retry if needed.`;
      if (found) login.value = "";
      ownedNamespaces = identities.namespaces.filter((entry) => entry.role === "owner");
      namespace.replaceChildren();
      for (const entry of ownedNamespaces) {
        const option = document.createElement("option");
        option.value = entry.name;
        option.textContent = entry.name;
        namespace.append(option);
      }
      namespace.value = uncertain.namespace;
      uncertain = undefined;
      refresh.hidden = true;
      unlock();
      if (document.activeElement === origin || document.activeElement === document.body)
        login.focus();
    } catch (error) {
      if (!signal.aborted && !reconnect(error))
        status.textContent = `The current invitation state could not be verified. Keep checking before another send. ${error instanceof Error ? error.message : "Check your connection."}`;
    } finally {
      busy = false;
      if (!signal.aborted) refresh.disabled = false;
    }
  });
  section.append(heading, guidance, form, refresh, status);
  mountedSection = section;
  host()!.append(section);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || button.disabled || signal.aborted) return;
    login.setAttribute("aria-invalid", String(!login.validity.valid));
    if (!form.checkValidity()) {
      status.textContent =
        "Enter a valid GitHub username: 1–39 letters, numbers or hyphens, starting with a letter or number.";
      login.focus();
      return;
    }
    const submitted = { namespace: namespace.value, login: login.value.trim(), role: role.value };
    if (
      !ownedNamespaces.some(
        (entry) => entry.name === submitted.namespace && entry.role === "owner",
      ) ||
      !["owner", "contributor"].includes(submitted.role)
    )
      return;
    busy = true;
    lock();
    const origin = document.activeElement;
    try {
      await request(
        `/v1/namespaces/${submitted.namespace}/members`,
        "POST",
        {
          githubLogin: submitted.login,
          role: submitted.role,
        },
        signal,
      );
      if (signal.aborted) return;
      status.textContent = `Invitation sent to ${submitted.login} as ${submitted.role} in ${submitted.namespace}. They must accept it before gaining membership.`;
      login.value = "";
      unlock();
      if (document.activeElement === origin || document.activeElement === document.body)
        login.focus();
    } catch (error) {
      if (signal.aborted) return;
      uncertain = submitted;
      if (!reconnect(error)) {
        status.textContent = `The invitation could not be confirmed; it may already have been recorded. Check access and pending invitations before another send. ${error instanceof Error ? error.message : "Check your connection."}`;
        refresh.hidden = false;
        if (document.activeElement === origin || document.activeElement === document.body)
          refresh.focus();
      }
    } finally {
      busy = false;
    }
  });
}
function mount() {
  pending?.abort();
  mountedSection?.remove();
  mountedSection = undefined;
  const controller = new AbortController();
  pending = controller;
  void initialize(controller.signal).catch((error: unknown) => {
    if (controller.signal.aborted) return;
    const message = document.createElement("p");
    message.setAttribute("role", "status");
    message.textContent = `Collaborator controls could not load. ${error instanceof Error ? error.message : "Retry by reloading this page."}`;
    mountedSection = message;
    host()?.append(message);
  });
}
window.addEventListener("pagehide", () => {
  pending?.abort();
  mountedSection?.remove();
  mountedSection = undefined;
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) mount();
});
mount();
