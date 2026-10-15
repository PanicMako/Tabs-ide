import { request, type Actor, type Namespace } from "./api";

interface Member {
  user_id: string;
  login: string;
  role: "owner" | "contributor";
}
interface Pending {
  id: string;
  login: string;
  role: string;
  expires_at: string;
}

async function initialize() {
  const actor = await request<Actor | null>("/v1/me");
  if (!actor) return;
  const result = await request<{ namespaces: Namespace[] }>("/v1/publisher/namespaces");
  for (const namespace of result.namespaces.filter((entry) => entry.role === "owner")) {
    const section = document.createElement("section");
    section.className = "card dashboard-task member-desk";
    const heading = document.createElement("h2");
    heading.textContent = `${namespace.name} team`;
    const guidance = document.createElement("p");
    guidance.textContent = "Manage who can publish and maintain extensions in this namespace.";
    const list = document.createElement("ul");
    const pending = document.createElement("ul");
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "button secondary ledger-refresh";
    refresh.textContent = `Refresh ${namespace.name} members`;
    const header = document.createElement("div");
    header.className = "section-heading";
    header.append(heading, refresh);
    const membersHeading = document.createElement("h3");
    membersHeading.textContent = "Members";
    const invitationsHeading = document.createElement("h3");
    invitationsHeading.textContent = "Invitations sent from this namespace";
    section.append(header, guidance, membersHeading, list, invitationsHeading, pending, status);
    (document.querySelector("#namespace-members") ??
      document.querySelector("#account-content"))!.append(section);
    let busy = false;
    function lockControls() {
      for (const control of section.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement
      >("input, textarea, button"))
        control.disabled = true;
    }
    function decisionActions(
      details: HTMLDetailsElement,
      form: HTMLFormElement,
      submit: HTMLButtonElement,
    ) {
      const actions = document.createElement("div");
      actions.className = "decision-actions";
      submit.className = "button decision-submit";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "button secondary";
      cancel.textContent = "Keep unchanged";
      function close() {
        if (busy) return;
        form.reset();
        details.open = false;
        details.querySelector("summary")!.focus();
      }
      cancel.addEventListener("click", close);
      details.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && details.open && !busy) {
          event.preventDefault();
          close();
        }
      });
      actions.append(submit, cancel);
      return actions;
    }
    async function mutate(action: () => Promise<unknown>, success: string) {
      if (busy) return;
      busy = true;
      const origin = document.activeElement;
      let recorded = false;
      lockControls();
      try {
        await action();
        recorded = true;
        await load();
        status.textContent = success;
      } catch (error) {
        list.replaceChildren();
        pending.replaceChildren();
        status.textContent = `${recorded ? "The action was recorded, but the updated members could not load." : "The action could not be confirmed; it may already have been recorded."} Refresh members before another action. ${error instanceof Error ? error.message : "Check your connection."}`;
      } finally {
        busy = false;
        refresh.disabled = false;
        if (document.activeElement === origin || document.activeElement === document.body)
          refresh.focus();
      }
    }
    async function load() {
      const data = await request<{ members: Member[]; invitations: Pending[] }>(
        `/v1/namespaces/${namespace.name}/members`,
      );
      list.replaceChildren();
      list.className = "team-roster";
      pending.className = "team-roster";
      const ownerCount = data.members.filter((member) => member.role === "owner").length;
      for (const member of data.members) {
        const item = document.createElement("li");
        const summary = document.createElement("p");
        summary.className = "member-identity";
        const name = document.createElement("strong");
        name.textContent = member.login;
        const role = document.createElement("span");
        role.className = "member-role";
        role.textContent = member.role;
        const monogram = document.createElement("span");
        monogram.className = "member-monogram";
        monogram.setAttribute("aria-hidden", "true");
        monogram.textContent = member.login.slice(0, 2).toUpperCase();
        summary.append(monogram, name, role);
        item.append(summary);
        if (member.role === "owner" && ownerCount === 1) {
          const protectedOwner = document.createElement("span");
          protectedOwner.className = "member-protected";
          protectedOwner.textContent = "Last owner";
          protectedOwner.title = "A namespace must keep at least one owner.";
          item.append(protectedOwner);
        } else if (/^[0-9]{1,19}$/.test(String(member.user_id))) {
          const details = document.createElement("details");
          details.className = "member-access";
          const title = document.createElement("summary");
          title.textContent = "Remove member";
          title.setAttribute("aria-label", `Remove ${member.login}`);
          const form = document.createElement("form");
          form.className = "member-decision";
          const explanation = document.createElement("p");
          explanation.textContent = `Remove ${member.login} from ${namespace.name}? This ends namespace and publish-token access. Published packages stay available. The last owner cannot be removed.`;
          const label = document.createElement("label");
          const reason = document.createElement("textarea");
          reason.required = true;
          reason.maxLength = 2000;
          reason.rows = 3;
          label.className = "decision-reason";
          label.append("Reason for removal (recorded in the audit history)", reason);
          const acknowledgement = document.createElement("label");
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.required = true;
          acknowledgement.className = "decision-acknowledgement";
          acknowledgement.append(
            checkbox,
            ` I understand that ${member.login} will lose namespace access.`,
          );
          const remove = document.createElement("button");
          remove.type = "submit";
          remove.textContent = `Remove ${member.login} from ${namespace.name}`;
          const actions = decisionActions(details, form, remove);
          form.append(explanation, label, acknowledgement, actions);
          details.append(title, form);
          item.append(details);
          form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (remove.disabled || !checkbox.checked || !reason.value.trim()) return;
            const auditReason = reason.value.trim();
            await mutate(
              () =>
                request(`/v1/namespaces/${namespace.name}/members/${member.user_id}`, "DELETE", {
                  reason: auditReason,
                }),
              `${member.login} removed. Reload this page if your own memberships changed.`,
            );
          });
        }
        list.append(item);
      }
      if (!data.members.length) {
        const empty = document.createElement("li");
        empty.textContent = "No members were returned. Refresh to check the current team.";
        list.append(empty);
      }
      pending.replaceChildren();
      if (!data.invitations.length) {
        const empty = document.createElement("li");
        empty.textContent = "No pending invitations.";
        pending.append(empty);
      }
      for (const invitation of data.invitations) {
        const item = document.createElement("li");
        const identity = document.createElement("p");
        identity.className = "member-identity";
        const name = document.createElement("strong");
        name.textContent = invitation.login;
        const role = document.createElement("span");
        role.className = "member-role";
        role.textContent = `${invitation.role} · invitation pending`;
        identity.append(name, role);
        item.append(identity);
        if (/^[1-9][0-9]*$/.test(invitation.id)) {
          const details = document.createElement("details");
          details.className = "member-access";
          const title = document.createElement("summary");
          title.textContent = "Cancel invitation";
          title.setAttribute("aria-label", `Cancel invitation to ${invitation.login}`);
          const form = document.createElement("form");
          const label = document.createElement("label");
          const reason = document.createElement("input");
          reason.required = true;
          reason.maxLength = 2000;
          form.className = "member-decision";
          label.className = "decision-reason";
          const explanation = document.createElement("p");
          explanation.textContent = `Cancel the invitation to ${invitation.login}? It expires ${invitation.expires_at}. Your reason will be recorded in the audit history.`;
          label.append(`Audit reason for revoking ${invitation.login}'s invitation`, reason);
          const revoke = document.createElement("button");
          revoke.type = "submit";
          revoke.textContent = `Revoke invitation to ${invitation.login}`;
          form.append(explanation, label, decisionActions(details, form, revoke));
          details.append(title, form);
          item.append(details);
          form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (revoke.disabled || !reason.value.trim()) return;
            const auditReason = reason.value.trim();
            await mutate(
              () =>
                request(
                  `/v1/namespaces/${namespace.name}/invitations/${invitation.id}/cancel`,
                  "POST",
                  { reason: auditReason },
                ),
              `Invitation to ${invitation.login} revoked.`,
            );
          });
        }
        pending.append(item);
      }
      status.textContent = `${data.members.length} current ${data.members.length === 1 ? "member" : "members"}.`;
    }
    async function reload() {
      if (busy) return;
      busy = true;
      const restoreFocus = document.activeElement === refresh;
      lockControls();
      try {
        await load();
      } catch (error) {
        list.replaceChildren();
        pending.replaceChildren();
        status.textContent = error instanceof Error ? error.message : "Members could not load.";
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
}
void initialize().catch((error: unknown) => {
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = error instanceof Error ? error.message : "Member management could not load.";
  document.querySelector("#account-content")!.append(status);
});
