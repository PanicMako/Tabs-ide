import { request } from "./api";

const namespace = document.querySelector<HTMLSelectElement>("#publish-namespace")!;
const display = document.querySelector<HTMLInputElement>("#tool-display-name")!;
const name = document.querySelector<HTMLInputElement>("#tool-package-name")!;
const check = document.querySelector<HTMLButtonElement>("#tool-name-check")!;
const search = document.querySelector<HTMLAnchorElement>("#tool-name-search")!;
const status = document.querySelector<HTMLElement>("#tool-name-status")!;
const selection = document.querySelector<HTMLElement>("#tool-name-selection")!;
const manifest = document.querySelector<HTMLElement>("#tool-name-manifest")!;
const copy = document.querySelector<HTMLButtonElement>("#tool-name-copy")!;
let generation = 0;
let controller: AbortController | undefined;
let editedName = false;
let checkedIdentity = "";

function invalidate() {
  generation++;
  controller?.abort();
  controller = undefined;
  check.disabled = false;
  checkedIdentity = "";
  selection.hidden = true;
  status.textContent = "Select a namespace and enter a package name to check it.";
  const query = display.value.trim() || name.value.trim();
  search.href = `/extensions${query ? `?${new URLSearchParams({ q: query })}` : ""}`;
}
function showSelection() {
  const title = display.value.trim() || name.value.trim();
  document.querySelector("#tool-name-title")!.textContent = title;
  document.querySelector("#tool-name-id")!.textContent = checkedIdentity;
  manifest.textContent = JSON.stringify(
    { publisher: namespace.value, name: name.value.trim(), displayName: title },
    null,
    2,
  );
  selection.hidden = false;
}
display.addEventListener("input", () => {
  if (!editedName)
    name.value = display.value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 63);
  invalidate();
});
name.addEventListener("input", () => {
  editedName = true;
  invalidate();
});
namespace.addEventListener("change", invalidate);
window.addEventListener("pagehide", invalidate);
check.addEventListener("click", async () => {
  invalidate();
  const publisher = namespace.value;
  const packageName = name.value.trim();
  if (!publisher) {
    status.textContent = "Select your publisher namespace first.";
    namespace.focus();
    return;
  }
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(packageName)) {
    status.textContent = "Use 2–63 lowercase letters, numbers or hyphens, starting with a letter.";
    name.focus();
    return;
  }
  const current = generation;
  const origin = document.activeElement;
  controller = new AbortController();
  const signal = controller.signal;
  check.disabled = true;
  status.textContent = `Checking ${publisher}.${packageName}…`;
  try {
    const result = await request<{ namespace: string; name: string; available: boolean }>(
      `/v1/publisher/name-check?${new URLSearchParams({ namespace: publisher, name: packageName })}`,
      "GET",
      undefined,
      signal,
    );
    if (current !== generation || signal.aborted) return;
    if (
      result?.namespace !== publisher ||
      result.name !== packageName ||
      typeof result.available !== "boolean"
    )
      throw new Error("The registry returned an unexpected name check. Try again.");
    checkedIdentity = `${publisher}.${packageName}`;
    status.textContent = result.available
      ? `${checkedIdentity} is available in your namespace right now. Use these manifest fields for your new tool.`
      : `${checkedIdentity} already exists in your namespace. Use it only to release a new version of that tool, or choose another package name.`;
    showSelection();
  } catch (error) {
    if (current !== generation || signal.aborted) return;
    status.textContent =
      error instanceof Error ? error.message : "The name could not be checked. Try again.";
  } finally {
    if (current === generation) {
      controller = undefined;
      check.disabled = false;
      if (origin === check && document.activeElement === document.body) check.focus();
    }
  }
});
copy.addEventListener("click", async () => {
  const current = generation;
  const identity = checkedIdentity;
  if (!identity || selection.hidden) return;
  try {
    await navigator.clipboard.writeText(manifest.textContent ?? "");
    if (current === generation)
      status.textContent = `Manifest fields for ${identity} copied. Add them to your source manifest and rebuild the package.`;
  } catch {
    if (current === generation)
      status.textContent =
        "Copy was unavailable. Select the manifest fields below and copy them manually.";
  }
});
