import { request, RegistryRequestError, type Actor } from "./api";
interface Report {
  id: string;
  namespace: string;
  name: string;
  version: string;
  category: string;
  details: string;
  status: "open" | "resolved";
  reporter_login: string;
  created_at: string;
  decisions?: Array<{ status: string; note: string; created_at: string }>;
}
const list = document.getElementById("reports-list")!;
const status = document.getElementById("reports-status")!;
const filter = document.getElementById("reports-filter") as HTMLSelectElement;
const refresh = document.getElementById("reports-refresh") as HTMLButtonElement;
let generation = 0;
let cursor: string | null = null;
const more = document.getElementById("reports-more") as HTMLButtonElement | null;
const text = (tag: string, value: string) => {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
};
async function load(append = false) {
  const current = ++generation;
  if (!append) {
    list.replaceChildren();
    cursor = null;
  }
  refresh.disabled = true;
  if (more) {
    more.disabled = true;
    more.hidden = true;
  }
  try {
    const actor = await request<Actor>("/v1/me");
    if (!actor.admin) throw new Error("Reviewer access is required to read private reports.");
    document.getElementById("reports-signin")!.hidden = true;
    const { reports, nextCursor } = await request<{
      reports: Report[];
      nextCursor?: string | null;
    }>(`/v1/review/reports?status=${filter.value}${append && cursor ? `&before=${cursor}` : ""}`);
    if (current !== generation) return;
    status.textContent = reports.length
      ? `${reports.length} reports shown.`
      : "No reports in this view.";
    cursor = nextCursor ?? null;
    if (more) more.hidden = !cursor;
    for (const report of reports) {
      const card = text("section", "");
      card.className = "operations-panel";
      const link = document.createElement("a");
      link.href = `/extensions/${encodeURIComponent(report.namespace)}/${encodeURIComponent(report.name)}`;
      link.textContent = `${report.namespace}.${report.name} · ${report.version}`;
      const details = text("p", report.details);
      details.style.whiteSpace = "pre-wrap";
      card.append(
        link,
        text(
          "p",
          `${report.category} · ${report.status} · @${report.reporter_login} · ${new Date(report.created_at).toLocaleString()}`,
        ),
        details,
      );
      if (Array.isArray(report.decisions)) {
        const history = document.createElement("details");
        history.append(text("summary", "Reviewer notes"));
        for (const decision of report.decisions)
          history.append(text("p", `${decision.status}: ${decision.note}`));
        card.append(history);
      }
      const form = document.createElement("form");
      form.className = "task-form";
      const label = text("label", "Private reviewer decision note");
      const note = document.createElement("textarea");
      note.required = true;
      note.maxLength = 2000;
      note.id = `note-${report.id}`;
      label.setAttribute("for", note.id);
      const button = document.createElement("button");
      button.type = "submit";
      button.className = "button secondary";
      button.textContent = report.status === "open" ? "Resolve report" : "Reopen report";
      const result = text("p", "");
      result.setAttribute("role", "status");
      form.append(label, note, button, result);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (button.disabled) return;
        button.disabled = true;
        try {
          await request(`/v1/review/reports/${report.id}`, "POST", {
            status: report.status === "open" ? "resolved" : "open",
            note: note.value,
          });
          await load();
        } catch (error) {
          if (
            error instanceof RegistryRequestError &&
            (error.status === 401 || error.status === 403)
          ) {
            generation++;
            list.replaceChildren();
            if (more) more.hidden = true;
            document.getElementById("reports-signin")!.hidden = false;
            status.textContent = "Reviewer access expired. Sign in again.";
            return;
          }
          result.textContent = `${error instanceof Error ? error.message : "Decision could not be confirmed."} Refresh reports before retrying.`;
        }
      });
      card.append(form);
      list.append(card);
    }
    status.textContent = list.children.length
      ? `${list.children.length} reports shown.`
      : "No reports in this view.";
  } catch (error) {
    if (current !== generation) return;
    list.replaceChildren();
    status.textContent = error instanceof Error ? error.message : "Reports unavailable.";
    document.getElementById("reports-signin")!.hidden = false;
  } finally {
    if (current === generation) {
      refresh.disabled = false;
      if (more) more.disabled = false;
    }
  }
}
refresh.addEventListener("click", () => void load());
filter.addEventListener("change", () => void load());
void load();

more?.addEventListener("click", () => void load(true));
