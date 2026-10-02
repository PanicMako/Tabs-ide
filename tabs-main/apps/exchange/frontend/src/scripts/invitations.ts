import { request, type Actor } from "./api";

interface Invitation {
  id: string;
  namespace: string;
  role: string;
  inviter_login: string;
  expires_at: string;
}
async function initialize() {
  const actor = await request<Actor | null>("/v1/me");
  if (!actor) return;
  const section = document.createElement("section");
  section.className = "card";
  const heading = document.createElement("h2");
  heading.textContent = "Pending invitations";
  const list = document.createElement("ul");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.textContent = "Refresh invitations";
  section.append(heading, list, status, refresh);
  document.querySelector("#account-content")!.append(section);
  async function load() {
    const result = await request<{ invitations: Invitation[] }>("/v1/publisher/invitations");
    list.replaceChildren();
    for (const invitation of result.invitations) {
      if (!/^[1-9][0-9]*$/.test(invitation.id)) continue;
      const item = document.createElement("li");
      const summary = document.createElement("p");
      summary.textContent = `${invitation.namespace} · ${invitation.role} · invited by ${invitation.inviter_login} · expires ${invitation.expires_at}`;
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      const terms = document.createElement("a");
      terms.href = "/publisher-terms";
      terms.textContent = `publisher terms (${actor!.termsVersion})`;
      label.append(checkbox, " I have read and accept the ", terms, ".");
      const accept = document.createElement("button");
      accept.type = "button";
      accept.textContent = "Accept invitation";
      accept.setAttribute(
        "aria-label",
        `Accept ${invitation.role} invitation to ${invitation.namespace}`,
      );
      accept.disabled = true;
      const decline = document.createElement("button");
      decline.type = "button";
      decline.textContent = "Decline invitation";
      decline.setAttribute("aria-label", `Decline invitation to ${invitation.namespace}`);
      checkbox.addEventListener("change", () => {
        accept.disabled = !checkbox.checked || !actor!.publishingEnabled;
      });
      async function decide(action: "accept" | "decline") {
        accept.disabled = true;
        decline.disabled = true;
        checkbox.disabled = true;
        try {
          await request(
            `/v1/publisher/invitations/${invitation.id}/${action}`,
            "POST",
            action === "accept" ? { acceptTermsVersion: actor!.termsVersion } : {},
          );
          await load();
          status.textContent =
            action === "accept"
              ? "Invitation accepted. Reload this page to update your memberships and publisher controls."
              : "Invitation declined.";
          refresh.focus();
        } catch (error) {
          status.textContent =
            error instanceof Error
              ? error.message
              : "Could not update invitation. Refresh before retrying.";
          checkbox.disabled = false;
          decline.disabled = false;
          accept.disabled = !checkbox.checked || !actor!.publishingEnabled;
        }
      }
      accept.addEventListener("click", () => {
        void decide("accept");
      });
      decline.addEventListener("click", () => {
        void decide("decline");
      });
      item.append(summary, label, accept, decline);
      list.append(item);
    }
    status.textContent = result.invitations.length
      ? `Showing ${result.invitations.length} pending invitations (maximum 100).`
      : "No pending invitations.";
  }
  async function reload() {
    refresh.disabled = true;
    try {
      await load();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Could not load invitations.";
    } finally {
      refresh.disabled = false;
    }
  }
  refresh.addEventListener("click", () => {
    void reload();
  });
  await reload();
}
void initialize().catch((error: unknown) => {
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  message.textContent =
    error instanceof Error ? error.message : "Invitation controls could not load. Reload to retry.";
  document.querySelector("#account-content")!.append(message);
});
