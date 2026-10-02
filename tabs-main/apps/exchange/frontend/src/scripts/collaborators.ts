import { request, type Actor, type Namespace } from "./api";

async function initialize() {
  const actor = await request<Actor | null>("/v1/me");
  if (!actor) return;
  const result = await request<{ namespaces: Namespace[] }>("/v1/publisher/namespaces");
  const section = document.createElement("section");
  section.className = "card";
  const heading = document.createElement("h2");
  heading.textContent = "Invite a collaborator";
  const guidance = document.createElement("p");
  guidance.textContent =
    "Enter the exact GitHub username of someone who has already signed in to this Exchange. Only owners can invite; recipients must accept the invitation.";
  const form = document.createElement("form");
  const namespaceLabel = document.createElement("label");
  namespaceLabel.htmlFor = "invite-namespace";
  namespaceLabel.textContent = "Namespace you own";
  const namespace = document.createElement("select");
  namespace.id = "invite-namespace";
  namespace.required = true;
  for (const entry of result.namespaces.filter((entry) => entry.role === "owner")) {
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
  login.autocomplete = "off";
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
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  if (!namespace.options.length)
    status.textContent = "You must own a namespace to invite collaborators.";
  else if (!actor.publishingEnabled)
    status.textContent = "Invitations are disabled while publishing is unavailable.";
  form.append(namespaceLabel, namespace, loginLabel, login, roleLabel, role, button);
  section.append(heading, guidance, form, status);
  document.querySelector("#account-content")!.append(section);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    try {
      await request(`/v1/namespaces/${namespace.value}/members`, "POST", {
        githubLogin: login.value.trim(),
        role: role.value,
      });
      status.textContent = `Invitation sent to ${login.value.trim()}. They must accept it before gaining membership.`;
      login.value = "";
    } catch (error) {
      status.textContent =
        error instanceof Error
          ? error.message
          : "Invitation failed. Check pending invitations before retrying.";
    } finally {
      button.disabled = false;
    }
  });
}
void initialize().catch((error: unknown) => {
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  message.textContent = `Collaborator controls could not load. ${error instanceof Error ? error.message : "Retry by reloading this page."}`;
  document.querySelector("#account-content")!.append(message);
});
