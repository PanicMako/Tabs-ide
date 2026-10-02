import { csrfToken, request, type Actor, type Namespace } from "./api";
import { uploadPackage, UncertainUploadError, validateUpload } from "./upload";

const form = document.querySelector<HTMLFormElement>("#publish-form")!;
const fields = document.querySelector<HTMLFieldSetElement>("#publish-fields")!;
const namespace = document.querySelector<HTMLSelectElement>("#publish-namespace")!;
const input = document.querySelector<HTMLInputElement>("#publish-file")!;
const agreement = document.querySelector<HTMLInputElement>("#publish-agreement")!;
const status = document.querySelector<HTMLElement>("#publish-status")!;
const meter = document.querySelector<HTMLProgressElement>("#publish-progress")!;
const cancel = document.querySelector<HTMLButtonElement>("#publish-cancel")!;
let file: File | undefined;
let eligible = false;
let termsVersion: string | undefined;
let controller: AbortController | undefined;

function choose(selected: File | undefined): void {
  file = undefined;
  try {
    if (!selected) throw new Error("Choose one package to continue.");
    validateUpload(selected);
    file = selected;
    document.querySelector("#publish-file-summary")!.textContent =
      `${selected.name} · ${(selected.size / 1024 / 1024).toFixed(2)} MiB`;
    status.textContent =
      "Package selected. Its manifest publisher must match your selected namespace.";
  } catch (error) {
    input.value = "";
    document.querySelector("#publish-file-summary")!.textContent = "";
    status.textContent = error instanceof Error ? error.message : "Invalid package.";
  }
}

input.addEventListener("change", () => choose(input.files?.[0]));
const drop = document.querySelector<HTMLElement>("#publish-drop")!;
drop.addEventListener("dragover", (event) => {
  event.preventDefault();
});
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  if (fields.disabled) return;
  if (event.dataTransfer?.files.length !== 1) {
    status.textContent = "Drop exactly one package.";
    return;
  }
  input.files = event.dataTransfer.files;
  choose(input.files[0]);
});
cancel.addEventListener("click", () => controller?.abort());
window.addEventListener("pagehide", () => controller?.abort());

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!eligible || controller || !file || !namespace.value || !agreement.checked) return;
  const packageFile = file;
  controller = new AbortController();
  fields.disabled = true;
  cancel.hidden = false;
  meter.hidden = false;
  meter.value = 0;
  let digest: string | undefined;
  try {
    if (!termsVersion) throw new Error("Reload publishing prerequisites before submitting.");
    status.textContent = "Recording publisher terms acceptance…";
    await request("/v1/publisher/agreement", "POST", { acceptTermsVersion: termsVersion });
    status.textContent = "Calculating package identity…";
    digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", await packageFile.arrayBuffer())),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    status.textContent = "Uploading package…";
    const accepted = await uploadPackage(
      packageFile,
      namespace.value,
      csrfToken(),
      controller.signal,
      (percent) => {
        meter.value = percent;
        status.textContent =
          percent === 100
            ? "Upload sent. Waiting for server validation…"
            : `Uploading: ${percent}%`;
      },
    );
    if (accepted.digest !== digest)
      throw new UncertainUploadError("The returned digest did not match your package.");
    location.assign(`/account/submissions/${digest}`);
  } catch (error) {
    if (error instanceof UncertainUploadError && digest) {
      status.textContent =
        "Checking whether the registry accepted your package before offering a retry…";
      try {
        const submission = await request<{ digest: string }>(`/v1/publisher/submissions/${digest}`);
        if (submission.digest !== digest) throw new Error("Unexpected package identity.");
        location.assign(`/account/submissions/${digest}`);
      } catch {
        status.textContent =
          "The upload outcome could not be confirmed. Cancellation does not withdraw an accepted submission. Check existing submissions before retrying; no automatic retry was made.";
      }
    } else status.textContent = error instanceof Error ? error.message : "Upload failed.";
  } finally {
    controller = undefined;
    fields.disabled = !eligible;
    cancel.hidden = true;
  }
});

async function initialize(): Promise<void> {
  try {
    const actor = await request<Actor | null>("/v1/me");
    if (!actor) {
      status.textContent = "Sign in with GitHub to publish.";
      return;
    }
    document.querySelector("#publish-terms")!.textContent =
      `Publisher terms version: ${actor.termsVersion}. Read this instance's terms before submitting.`;
    termsVersion = actor.termsVersion;
    const accepted = await request<{ termsVersion: string; acceptedAt: string | null }>(
      "/v1/publisher/agreement",
    );
    if (accepted.termsVersion === termsVersion && accepted.acceptedAt) {
      agreement.checked = true;
      document.querySelector("#publish-terms")!.textContent =
        `Publisher terms ${termsVersion} accepted on ${accepted.acceptedAt}.`;
    }
    const memberships = await request<{ namespaces: Namespace[] }>("/v1/publisher/namespaces");
    for (const entry of memberships.namespaces) {
      const option = document.createElement("option");
      option.value = entry.name;
      option.textContent = `${entry.name} (${entry.role})`;
      namespace.append(option);
    }
    eligible = actor.publishingEnabled && memberships.namespaces.length > 0;
    fields.disabled = !eligible;
    status.textContent = !actor.publishingEnabled
      ? "Publishing is disabled on this registry. You can still build and test your extension locally."
      : !memberships.namespaces.length
        ? "Create a namespace or accept an invitation before submitting."
        : "Select a namespace, accept the terms, and choose your package.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Unable to load prerequisites.";
  }
}
void initialize();
