import { request, type Actor } from "./api";
import {
  createSigningBackup,
  lockBackup,
  unlockBackup,
  signRelease,
  fingerprint,
  type SigningBackup,
  type ReleasePlan,
} from "../lib/releaseSigning";
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
const status = el("release-status");
let backup: SigningBackup | undefined,
  plan: ReleasePlan | undefined,
  state: Pick<ReleasePlan, "origin" | "root" | "pin" | "versions">;
let busy = false,
  attempted = false,
  timer: ReturnType<typeof setTimeout> | undefined;
function download(name: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function controls() {
  for (const button of el("release-wizard").querySelectorAll<HTMLButtonElement>("button"))
    button.disabled = busy;
  el<HTMLButtonElement>("release-load").disabled = busy || !backup || !state?.pin;
  el<HTMLButtonElement>("release-publish").disabled =
    busy || !backup || !plan || !input("release-confirm").checked || attempted;
  el("release-lock").hidden = !backup;
}
async function run(action: () => Promise<void>) {
  if (busy) return;
  busy = true;
  controls();
  try {
    await action();
  } catch (error) {
    status.textContent =
      error instanceof Error
        ? error.message
        : "Could not complete this step. Refresh the page to check its status before retrying.";
  } finally {
    busy = false;
    controls();
  }
}
function lock() {
  backup = undefined;
  plan = undefined;
  clearTimeout(timer);
  input("release-password").value = "";
  input("release-confirm").checked = false;
  el("release-root").hidden = true;
  el("release-targets").replaceChildren();
  el("release-plan-status").textContent = "";
  controls();
}
function renderState() {
  (el("release-create") as HTMLDetailsElement).open = !state.pin;
  el("release-trust-state").textContent = state.pin
    ? "Your registry has a trust identity. Open the matching signing backup to continue."
    : "First release: create a backup, reopen it, then confirm your registry’s trust identity.";
  el("release-create").hidden = Boolean(state.pin);
  el("release-origin").textContent = state.origin;
}
async function loadState() {
  state = await request("/v1/operator/releases");
  renderState();
}
el("release-generate").addEventListener(
  "click",
  () =>
    void run(async () => {
      if (state.pin) throw new Error("Signing is already configured. Open the existing backup.");
      const password = input("release-new-password").value;
      if (password !== input("release-repeat-password").value)
        throw new Error("The backup passwords don’t match.");
      if (password.length < 12)
        throw new Error("Choose a backup password with at least 12 characters.");
      const created = await createSigningBackup(state.origin);
      const encrypted = await lockBackup(created, password);
      download("tabs-signing-backup.json", encrypted);
      input("release-new-password").value = "";
      input("release-repeat-password").value = "";
      status.textContent =
        "Backup created. Choose the downloaded file below and enter its password to check that it opens. No signing keys were sent to the server.";
    }),
);
el("release-choose").addEventListener("click", () => input("release-backup-file").click());
input("release-backup-file").addEventListener("change", () => {
  lock();
  el("release-filename").textContent =
    input("release-backup-file").files?.[0]?.name ?? "No file chosen";
});
el("release-unlock").addEventListener(
  "click",
  () =>
    void run(async () => {
      const password = input("release-password").value;
      lock();
      const file = input("release-backup-file").files?.[0];
      if (!file || file.size > 100000)
        throw new Error("Choose your encrypted signing backup (up to 100 KB).");
      // Read the password before clearing it. File contents never enter a network request.
      backup = await unlockBackup(await file.text(), password, state.origin);
      input("release-password").value = "";
      const pin = await fingerprint(backup.root);
      if (state.pin && state.pin !== pin) {
        lock();
        throw new Error("This backup belongs to a different signing identity.");
      }
      el("release-root-hash").textContent = pin;
      el("release-root").hidden = false;
      el("release-register").hidden = Boolean(state.pin);
      status.textContent =
        "Backup verified and unlocked on this device for 10 minutes. No private keys were uploaded.";
      timer = setTimeout(() => {
        lock();
        status.textContent = "Signing backup locked after 10 minutes. Reopen it to continue.";
      }, 600000);
    }),
);
el("release-lock").addEventListener("click", () => {
  lock();
  status.textContent = "Signing backup locked.";
});
el("release-download-root").addEventListener("click", () => {
  if (backup) download("root.json", backup.root);
});
el("release-copy-pin").addEventListener(
  "click",
  () =>
    void run(async () => {
      if (!backup) return;
      await navigator.clipboard.writeText(await fingerprint(backup.root));
      status.textContent = "Public trust fingerprint copied.";
    }),
);
el<HTMLFormElement>("release-register").addEventListener("submit", (event) => {
  event.preventDefault();
  void run(async () => {
    if (!backup) throw new Error("Unlock your backup first.");
    const pin = await fingerprint(backup.root);
    if (
      input("release-confirm-origin").value.trim() !== state.origin ||
      input("release-confirm-pin").value.trim() !== pin
    )
      throw new Error("Confirm the exact registry address and fingerprint shown above.");
    await request("/v1/operator/releases/setup", "POST", {
      root: backup.root,
      fingerprint: pin,
      confirmOrigin: state.origin,
    });
    await loadState();
    el("release-register").hidden = true;
    status.textContent = "Trust identity registered. Next, load the approved releases.";
  });
});
el("release-load").addEventListener(
  "click",
  () =>
    void run(async () => {
      plan = undefined;
      attempted = false;
      input("release-confirm").checked = false;
      const result = await request<ReleasePlan>("/v1/operator/releases/plan");
      if (
        !backup ||
        result.origin !== state.origin ||
        result.pin !== (await fingerprint(backup.root)) ||
        result.root !== backup.root
      )
        throw new Error("The release plan does not match this signing backup.");
      const list = el("release-targets");
      list.replaceChildren();
      for (const [path, target] of Object.entries(result.targets)) {
        if (
          !/^extensions\/[a-z][a-z0-9-]{1,62}\/[a-z][a-z0-9-]{1,62}\/[0-9A-Za-z.+-]{1,128}\.tabsext$/.test(
            path,
          ) ||
          !Number.isSafeInteger(target.length) ||
          target.length < 1 ||
          !/^[a-f0-9]{64}$/.test(target.hashes.sha256)
        )
          throw new Error("Invalid release plan. Contact the registry operator.");
        const item = document.createElement("li"),
          title = document.createElement("strong"),
          detail = document.createElement("code");
        title.textContent = path.replace(/^extensions\//, "");
        detail.textContent = `${target.length.toLocaleString()} bytes · SHA-256 ${target.hashes.sha256}`;
        item.append(title, detail);
        list.append(item);
      }
      plan = result;
      const count = Object.keys(result.targets).length;
      el("release-plan-status").textContent = count
        ? `${count} approved version(s) in this signed release. Review every package above.`
        : "No approved packages remain. Publishing this plan removes revoked packages from the signed catalog.";
      status.textContent = "Plan loaded. Review it, check the confirmation, then sign and publish.";
    }),
);
input("release-confirm").addEventListener("change", controls);
el("release-publish").addEventListener(
  "click",
  () =>
    void run(async () => {
      if (!backup || !plan || !input("release-confirm").checked || attempted)
        throw new Error("Unlock your backup, load a plan, and confirm it first.");
      const signed = await signRelease(plan, backup);
      attempted = true;
      el("release-result").textContent =
        "Signatures created on your device. Verifying and publishing…";
      try {
        await request("/v1/operator/releases/publish", "POST", signed);
      } catch {
        el("release-result").textContent =
          "Publication could not be confirmed. It may have succeeded. Check Submissions and the catalog before refreshing this page and trying again. No automatic retry was made.";
        return;
      }
      el("release-result").textContent = "Signed release published successfully.";
      el("release-done").hidden = false;
      const links = el("release-listings");
      links.replaceChildren();
      const seen = new Set<string>();
      for (const path of Object.keys(plan.targets)) {
        const [, publisher, name] = path.split("/");
        const id = `${publisher}/${name}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const a = document.createElement("a");
        a.href = `/extensions/${id}`;
        a.textContent = `View ${publisher}.${name} ↗`;
        links.append(a);
      }
      status.textContent = "Publication complete. Your next steps are below.";
      el("release-done").scrollIntoView({ block: "start", behavior: "auto" });
    }),
);
el("release-download-connection").addEventListener("click", () => {
  if (!state?.pin) return;
  download(
    "tabs-exchange-connection.json",
    JSON.stringify(
      {
        TABS_EXCHANGE_ORIGIN: state.origin,
        TABS_EXCHANGE_TRUST_ROOT_PATH: "/absolute/path/to/root.json",
        TABS_EXCHANGE_TRUST_ROOT_SHA256: state.pin,
        TABS_EXCHANGE_TRUST_ID: `registry-${state.pin.slice(0, 16)}`,
      },
      null,
      2,
    ),
  );
});
window.addEventListener("pagehide", lock);
void run(async () => {
  const actor = await request<Actor | null>("/v1/me");
  if (!actor?.operator)
    throw new Error(
      "Sign in with the registry operator account to set up signing or publish releases. Reviewer approval alone does not grant signing access.",
    );
  await loadState();
  el("release-wizard").hidden = false;
  status.textContent =
    "Start with your signing backup. Nothing is published until you confirm step 3.";
});
