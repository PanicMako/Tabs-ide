import { request } from "./api";
import { submissionLifecycle } from "@tabs/shared/extensionSubmission";

interface Submission {
  namespace: string;
  name: string;
  version: string;
  digest: string;
  status: string;
  published: boolean;
}
const refresh = document.getElementById("submissions-refresh") as HTMLButtonElement;
const status = document.getElementById("submissions-count")!;
async function load() {
  refresh.disabled = true;
  try {
    const body = await request<{ submissions: Submission[] }>("/v1/publisher/submissions");
    const list = document.getElementById("account-submissions")!;
    list.replaceChildren();
    for (const submission of body.submissions) {
      if (!/^[a-f0-9]{64}$/.test(submission.digest))
        throw new Error("Registry returned an invalid submission identity.");
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `/account/submissions/${submission.digest}`;
      link.textContent = `${submission.namespace}.${submission.name}@${submission.version}`;
      item.append(link, document.createTextNode(` · ${submissionLifecycle(submission).label}`));
      list.append(item);
    }
    status.textContent = body.submissions.length
      ? `${body.submissions.length} recent submissions shown (up to 100). Open a version to follow its status.`
      : "No submissions yet. Build a tool and submit its validated archive.";
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : "Submissions unavailable. Refresh to retry.";
  } finally {
    refresh.disabled = false;
  }
}
refresh.addEventListener("click", () => void load());
void load();
