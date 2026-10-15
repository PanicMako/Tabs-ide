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
  section.className = "card dashboard-task invitation-desk";
  const heading = document.createElement("h2");
  heading.textContent = "Invitations for you";
  const guidance = document.createElement("p");
  guidance.textContent =
    "Other publishers can invite you to join their namespace. Review those invitations here.";
  const list = document.createElement("ul");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "button secondary ledger-refresh";
  refresh.textContent = "Refresh invitations";
  section.append(heading, guidance, list, status, refresh);
  (document.querySelector("#namespace-invitations") ??
    document.querySelector("#account-content"))!.append(section);
  let busy = false;
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
        accept.disabled = busy || !checkbox.checked || !actor!.publishingEnabled;
      });
      async function decide(action: "accept" | "decline") {
        if (
          busy ||
          (action === "accept"
            ? accept.disabled || !checkbox.checked || !actor!.publishingEnabled
            : decline.disabled)
        )
          return;
        busy = true;
        const origin = document.activeElement;
        let recorded = false;
        refresh.disabled = true;
        for (const control of list.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
          "input, button",
        ))
          control.disabled = true;
        try {
          await request(
            `/v1/publisher/invitations/${invitation.id}/${action}`,
            "POST",
            action === "accept" ? { acceptTermsVersion: actor!.termsVersion } : {},
          );
          recorded = true;
          await load();
          status.textContent =
            action === "accept"
              ? "Invitation accepted. Reload this page to update your memberships and publisher controls."
              : "Invitation declined.";
        } catch (error) {
          list.replaceChildren();
          status.textContent = `${recorded ? "The decision was recorded, but the updated list could not load." : "The decision could not be confirmed; it may already have been recorded."} Refresh invitations before another decision. ${error instanceof Error ? error.message : "Check your connection."}`;
        } finally {
          busy = false;
          refresh.disabled = false;
          if (document.activeElement === origin || document.activeElement === document.body)
            refresh.focus();
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
    if (busy) return;
    busy = true;
    const restoreFocus = document.activeElement === refresh;
    refresh.disabled = true;
    try {
      await load();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Could not load invitations.";
    } finally {
      busy = false;
      refresh.disabled = false;
      if (
        restoreFocus &&
        (document.activeElement === refresh || document.activeElement === document.body)
      )
        refresh.focus();
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
  (document.querySelector("#namespace-invitations") ??
    document.querySelector("#account-content"))!.append(message);
});
