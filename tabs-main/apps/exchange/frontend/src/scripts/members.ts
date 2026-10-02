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
    section.className = "card";
    const heading = document.createElement("h2");
    heading.textContent = `Manage ${namespace.name}`;
    const guidance = document.createElement("p");
    guidance.textContent =
      "Removing membership stops namespace access, including publish-token access. It does not delete published packages. The last owner cannot be removed.";
    const list = document.createElement("ul");
    const pending = document.createElement("ul");
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.textContent = `Refresh ${namespace.name} members`;
    section.append(heading, guidance, list, pending, status, refresh);
    document.querySelector("#account-content")!.append(section);
    async function load() {
      const data = await request<{ members: Member[]; invitations: Pending[] }>(
        `/v1/namespaces/${namespace.name}/members`,
      );
      list.replaceChildren();
      for (const member of data.members) {
        const item = document.createElement("li");
        const summary = document.createElement("p");
        summary.textContent = `${member.login} · ${member.role}`;
        item.append(summary);
        if (/^[0-9]{1,19}$/.test(String(member.user_id))) {
          const details = document.createElement("details");
          const title = document.createElement("summary");
          title.textContent = `Remove ${member.login}`;
          const form = document.createElement("form");
          const label = document.createElement("label");
          const reason = document.createElement("textarea");
          reason.required = true;
          reason.maxLength = 2000;
          label.append("Reason for removal (recorded in the audit history)", reason);
          const acknowledgement = document.createElement("label");
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.required = true;
          acknowledgement.append(
            checkbox,
            ` I understand that ${member.login} will lose namespace access.`,
          );
          const remove = document.createElement("button");
          remove.type = "submit";
          remove.textContent = `Remove ${member.login} from ${namespace.name}`;
          form.append(label, acknowledgement, remove);
          details.append(title, form);
          item.append(details);
          form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (remove.disabled || !checkbox.checked || !reason.value.trim()) return;
            remove.disabled = true;
            try {
              await request(
                `/v1/namespaces/${namespace.name}/members/${member.user_id}`,
                "DELETE",
                { reason: reason.value.trim() },
              );
              await load();
              status.textContent = `${member.login} removed. Reload this page if your own memberships changed.`;
              refresh.focus();
            } catch (error) {
              status.textContent =
                error instanceof Error ? error.message : "Removal failed. Refresh before retrying.";
              remove.disabled = false;
            }
          });
        }
        list.append(item);
      }
      pending.replaceChildren();
      if (!data.invitations.length) {
        const empty = document.createElement("li");
        empty.textContent = "No pending invitations.";
        pending.append(empty);
      }
      for (const invitation of data.invitations) {
        const item = document.createElement("li");
        item.append(
          `Pending: ${invitation.login} (${invitation.role}, expires ${invitation.expires_at})`,
        );
        if (/^[1-9][0-9]*$/.test(invitation.id)) {
          const form = document.createElement("form");
          const label = document.createElement("label");
          const reason = document.createElement("input");
          reason.required = true;
          reason.maxLength = 2000;
          label.append(`Audit reason for revoking ${invitation.login}'s invitation`, reason);
          const revoke = document.createElement("button");
          revoke.type = "submit";
          revoke.textContent = `Revoke invitation to ${invitation.login}`;
          form.append(label, revoke);
          item.append(form);
          form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (revoke.disabled || !reason.value.trim()) return;
            revoke.disabled = true;
            try {
              await request(
                `/v1/namespaces/${namespace.name}/invitations/${invitation.id}/cancel`,
                "POST",
                { reason: reason.value.trim() },
              );
              await load();
              status.textContent = `Invitation to ${invitation.login} revoked.`;
              refresh.focus();
            } catch (error) {
              status.textContent =
                error instanceof Error
                  ? error.message
                  : "Revocation failed. Refresh before retrying.";
              revoke.disabled = false;
            }
          });
        }
        pending.append(item);
      }
      status.textContent = `${data.members.length} current members.`;
    }
    async function reload() {
      refresh.disabled = true;
      try {
        await load();
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "Members could not load.";
      } finally {
        refresh.disabled = false;
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
