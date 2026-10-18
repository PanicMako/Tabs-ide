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
const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
let file: File | undefined;
let eligible = false;
let canPrepare = false;
let registryOpen: boolean | undefined;
let generation = 0;
let lifetime = new AbortController();
const chooseButton = document.querySelector<HTMLButtonElement>("#publish-choose-file");
const removeButton = document.querySelector<HTMLButtonElement>("#publish-remove-file");
function message(text: string, state = "info") {
  status.textContent = text;
  status.dataset.state = state;
}
function availability(title: string, description: string) {
  const heading = document.getElementById("publish-gate-title");
  const note = document.getElementById("publish-availability-note");
  if (heading) heading.textContent = title;
  if (note) note.textContent = description;
}
let termsVersion: string | undefined;
let recordedTermsVersion: string | undefined;
let controller: AbortController | undefined;

function updateSubmit(): void {
  submit.disabled =
    !eligible || Boolean(controller) || !file || !namespace.value || !agreement.checked;
  const publisherSummary = document.getElementById("publish-summary-namespace");
  if (publisherSummary) publisherSummary.textContent = namespace.value || "Choose a namespace";
  const packageSummary = document.getElementById("publish-summary-package");
  if (packageSummary) packageSummary.textContent = file?.name || "No file selected";
  const submissionSummary = document.getElementById("publish-summary-availability");
  if (submissionSummary)
    submissionSummary.textContent =
      registryOpen === undefined
        ? "Account check needed"
        : !registryOpen
          ? "Uploads not open yet"
          : "Open for review";
  const note = document.getElementById("publish-submit-note");
  if (note)
    note.textContent = controller
      ? "Your package is being prepared and sent. You can cancel below."
      : !canPrepare
        ? "Sign in and load your publishing account to prepare a submission."
        : !registryOpen
          ? "Uploads are not open yet. You can choose your namespace and check a file now; nothing will be sent."
          : !namespace.value
            ? "Choose a publisher namespace before sending."
            : !file
              ? "Choose a .tabsext package before sending."
              : !agreement.checked
                ? "Read and accept the current publisher terms before sending."
                : "Your file passed the basic size and filename checks. The registry checks its contents after upload.";
}

namespace.addEventListener("change", updateSubmit);
agreement.addEventListener("change", updateSubmit);

function clearPackage(resetInput = true): void {
  file = undefined;
  if (removeButton) removeButton.hidden = true;
  if (chooseButton) chooseButton.textContent = "Choose a package ↗";
  if (resetInput) input.value = "";
  document.querySelector<HTMLElement>("#publish-drop")!.dataset.selected = "false";
  document.querySelector("#publish-file-summary")!.textContent = "";
  updateSubmit();
}

function choose(selected: File | undefined): void {
  if (!canPrepare || fields.disabled) return;
  clearPackage(false);
  try {
    if (!selected) throw new Error("Choose one package to continue.");
    validateUpload(selected);
    file = selected;
    document.querySelector<HTMLElement>("#publish-drop")!.dataset.selected = "true";
    const size =
      selected.size < 1024
        ? `${selected.size} B`
        : selected.size < 1024 * 1024
          ? `${(selected.size / 1024).toFixed(2)} KiB`
          : `${(selected.size / 1024 / 1024).toFixed(2)} MiB`;
    document.querySelector("#publish-file-summary")!.textContent = `${selected.name} · ${size}`;
    if (removeButton) removeButton.hidden = false;
    if (chooseButton) chooseButton.textContent = "Choose a different package ↗";
    message(
      "Selected on your device. Its manifest publisher must match your selected namespace. Contents are checked by the registry after upload.",
    );
  } catch (error) {
    input.value = "";
    message(error instanceof Error ? error.message : "Invalid package.", "error");
  }
  updateSubmit();
}

input.addEventListener("change", () => choose(input.files?.[0]));
chooseButton?.addEventListener("click", () => input.click());
removeButton?.addEventListener("click", () => {
  clearPackage();
  message("File removed. Nothing was uploaded.");
  chooseButton?.focus();
});
const drop = document.querySelector<HTMLElement>("#publish-drop")!;
drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (!fields.disabled) {
    drop.dataset.dragging = "true";
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }
});
drop.addEventListener("dragleave", (event) => {
  if (!(event.relatedTarget instanceof Node) || !drop.contains(event.relatedTarget))
    delete drop.dataset.dragging;
});
drop.addEventListener("dragend", () => delete drop.dataset.dragging);
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  delete drop.dataset.dragging;
  if (fields.disabled) return;
  if (event.dataTransfer?.files.length !== 1) {
    clearPackage();
    message("Drop exactly one package.", "error");
    return;
  }
  input.files = event.dataTransfer.files;
  choose(input.files[0]);
});
cancel.addEventListener("click", () => controller?.abort());
window.addEventListener("pagehide", () => {
  generation++;
  lifetime.abort();
  controller?.abort();
  canPrepare = false;
  eligible = false;
  fields.disabled = true;
  updateSubmit();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) void initialize();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!eligible || controller || !file || !namespace.value || !agreement.checked) return;
  const packageFile = file;
  const version = generation;
  const activeController = new AbortController();
  controller = activeController;
  updateSubmit();
  fields.disabled = true;
  cancel.hidden = false;
  meter.hidden = false;
  meter.value = 0;
  let digest: string | undefined;
  try {
    if (!termsVersion) throw new Error("Reload publishing prerequisites before submitting.");
    if (recordedTermsVersion !== termsVersion) {
      status.textContent = "Recording publisher terms acceptance…";
      await request("/v1/publisher/agreement", "POST", { acceptTermsVersion: termsVersion });
      if (version !== generation) return;
      recordedTermsVersion = termsVersion;
    }
    if (version !== generation) return;
    if (activeController.signal.aborted)
      throw new Error("Upload cancelled before the package was sent.");
    status.textContent = "Calculating package identity…";
    digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", await packageFile.arrayBuffer())),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    if (version !== generation) return;
    if (activeController.signal.aborted)
      throw new Error("Upload cancelled before the package was sent.");
    status.textContent = "Uploading package…";
    const accepted = await uploadPackage(
      packageFile,
      namespace.value,
      csrfToken(),
      activeController.signal,
      (percent) => {
        meter.value = percent;
        status.textContent =
          percent === 100
            ? "Upload sent. Waiting for server validation…"
            : `Uploading: ${percent}%`;
      },
    );
    if (version !== generation) return;
    if (accepted.digest !== digest)
      throw new UncertainUploadError("The returned digest did not match your package.");
    location.assign(`/account/submissions/${digest}`);
  } catch (error) {
    if (version !== generation) return;
    if (error instanceof UncertainUploadError && digest) {
      status.textContent =
        "Checking whether the registry accepted your package before offering a retry…";
      try {
        const submission = await request<{ digest: string }>(`/v1/publisher/submissions/${digest}`);
        if (version !== generation) return;
        if (submission.digest !== digest) throw new Error("Unexpected package identity.");
        location.assign(`/account/submissions/${digest}`);
      } catch {
        if (version !== generation) return;
        status.textContent =
          "The upload outcome could not be confirmed. Cancellation does not withdraw an accepted submission. Check existing submissions before retrying; no automatic retry was made.";
      }
    } else status.textContent = error instanceof Error ? error.message : "Upload failed.";
  } finally {
    if (controller === activeController) controller = undefined;
    if (version === generation) {
      fields.disabled = !canPrepare;
      cancel.hidden = true;
      meter.hidden = true;
      updateSubmit();
    }
  }
});

async function initialize(): Promise<void> {
  const version = ++generation;
  lifetime.abort();
  lifetime = new AbortController();
  const { signal } = lifetime;
  const current = () => version === generation && !signal.aborted;
  controller?.abort();
  controller = undefined;
  eligible = false;
  canPrepare = false;
  registryOpen = undefined;
  fields.disabled = true;
  agreement.checked = false;
  recordedTermsVersion = undefined;
  termsVersion = undefined;
  clearPackage();
  cancel.hidden = true;
  meter.hidden = true;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.disabled = true;
  placeholder.textContent = "Choose your publisher name";
  namespace.replaceChildren(placeholder);
  try {
    const actor = await request<Actor | null>("/v1/me", "GET", undefined, signal);
    if (!current()) return;
    if (!actor) {
      availability(
        "Sign in to prepare your release.",
        "Your publishing account supplies the namespaces you can use.",
      );
      message("Sign in with GitHub to prepare a package and publish.");
      return;
    }
    if (
      typeof actor.publishingEnabled !== "boolean" ||
      typeof actor.termsVersion !== "string" ||
      !actor.termsVersion
    )
      throw new Error(
        "Publishing account information is invalid. Reload before preparing a release.",
      );
    termsVersion = actor.termsVersion;
    document.querySelector("#publish-terms")!.textContent =
      `Current publisher terms: ${actor.termsVersion}. Acceptance is recorded only when you submit.`;
    let agreementWarning = "";
    try {
      const accepted = await request<{ termsVersion: string; acceptedAt: string | null }>(
        "/v1/publisher/agreement",
        "GET",
        undefined,
        signal,
      );
      if (!current()) return;
      if (accepted.termsVersion === termsVersion && accepted.acceptedAt) {
        recordedTermsVersion = termsVersion;
        agreement.checked = true;
        document.querySelector("#publish-terms")!.textContent =
          "You’ve already accepted the current publisher terms.";
      }
    } catch {
      if (!current()) return;
      agreementWarning =
        "Previous terms acceptance could not be loaded. Read and accept the current terms before submitting.";
    }
    const memberships = await request<{ namespaces: Namespace[] }>(
      "/v1/publisher/namespaces",
      "GET",
      undefined,
      signal,
    );
    if (!current()) return;
    if (
      !Array.isArray(memberships?.namespaces) ||
      memberships.namespaces.length > 100 ||
      memberships.namespaces.some(
        (entry) =>
          !entry ||
          typeof entry.name !== "string" ||
          !/^[a-z][a-z0-9-]{1,62}$/.test(entry.name) ||
          !["owner", "contributor"].includes(entry.role),
      )
    )
      throw new Error("Publisher namespaces could not be verified. Reload before continuing.");
    for (const entry of memberships.namespaces) {
      const option = document.createElement("option");
      option.value = entry.name;
      option.textContent = `${entry.name} (${entry.role})`;
      namespace.append(option);
    }
    canPrepare = true;
    registryOpen = actor.publishingEnabled;
    eligible = registryOpen && memberships.namespaces.length > 0;
    fields.disabled = false;
    namespace.disabled = !memberships.namespaces.length;
    if (memberships.namespaces.length === 1) namespace.value = memberships.namespaces[0]!.name;
    namespace.dispatchEvent(new Event("change", { bubbles: true }));
    const help = document.getElementById("publish-namespace-help");
    if (help)
      help.textContent = !memberships.namespaces.length
        ? "Create a namespace or accept an invitation to choose a publisher. You can still check a file below."
        : memberships.namespaces.length === 1
          ? "Your publisher name is selected. The archive’s publisher must match this name."
          : "Choose the person or team publishing this version. The archive’s publisher must match.";
    const agreementPanel = document.getElementById("publish-agreement-panel");
    if (agreementPanel) agreementPanel.hidden = !registryOpen;
    availability(
      registryOpen ? "Open for submissions." : "Prepare now. Submit when uploads open.",
      registryOpen
        ? "Choose your namespace and package, then send it for review."
        : "Namespace selection and local file checks work now. Sending to the Exchange is not available yet.",
    );
    message(agreementWarning);
    updateSubmit();
  } catch (error) {
    if (!current()) return;
    canPrepare = false;
    eligible = false;
    fields.disabled = true;
    availability(
      "Your publishing account couldn’t load.",
      "Reload this page to try again. Preparation stays locked until your account is confirmed.",
    );
    message(error instanceof Error ? error.message : "Unable to load prerequisites.", "error");
    updateSubmit();
  }
}
void initialize();
