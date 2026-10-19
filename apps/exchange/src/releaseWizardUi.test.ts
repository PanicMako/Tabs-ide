// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createSigningBackup, fingerprint, lockBackup } from "../frontend/src/lib/releaseSigning";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../frontend/src/scripts/api", () => ({ request: api.request }));
let detach = () => {};
beforeEach(() => {
  vi.resetModules();
  api.request.mockReset();
  vi.stubGlobal("crypto", webcrypto);
  const events = vi.spyOn(window, "addEventListener");
  detach = () => {
    for (const [type, listener, options] of events.mock.calls)
      window.removeEventListener(type, listener, options);
  };
  const page = readFileSync("frontend/src/pages/admin/releases.astro", "utf8");
  document.body.innerHTML = page.match(/<Operations[^>]*>([\s\S]*?)<\/Operations>/)![1]!;
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  detach();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
it("guides an operator from a local encrypted backup to an explicitly confirmed signed publication without sending private material", async () => {
  const origin = "https://exchange.example",
    password = "a strong backup password",
    backup = await createSigningBackup(origin),
    encrypted = await lockBackup(backup, password),
    pin = await fingerprint(backup.root);
  let registered = false;
  const plan = {
    origin,
    root: backup.root,
    pin,
    versions: { root: 0, targets: 0, snapshot: 0, timestamp: 0 },
    targets: {
      "extensions/maker/tool/1.0.0.tabsext": { length: 10, hashes: { sha256: "a".repeat(64) } },
    },
  };
  api.request.mockImplementation(async (path: string) => {
    if (path === "/v1/me") return { operator: true };
    if (path === "/v1/operator/releases")
      return { origin, root: null, pin: registered ? pin : null, versions: plan.versions };
    if (path.endsWith("/setup")) {
      registered = true;
      return { pin };
    }
    if (path.endsWith("/plan")) return plan;
    if (path.endsWith("/publish")) return { published: 4 };
    throw new Error(path);
  });
  await import("../frontend/src/scripts/release-wizard");
  await vi.waitFor(() => expect(document.getElementById("release-wizard")!.hidden).toBe(false));
  Object.defineProperty(field("release-backup-file"), "files", {
    configurable: true,
    value: [{ size: encrypted.length, name: "backup.json", text: async () => encrypted }],
  });
  field("release-password").value = password;
  button("release-unlock").click();
  await vi.waitFor(() => expect(document.getElementById("release-root")!.hidden).toBe(false));
  expect(field("release-password").value).toBe("");
  expect(button("release-load").disabled).toBe(true);
  const form = document.getElementById("release-register")!;
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() =>
    expect(document.getElementById("release-status")!.textContent).toContain("Confirm the exact"),
  );
  expect(api.request.mock.calls.some((call) => call[0].endsWith("/setup"))).toBe(false);
  field("release-confirm-origin").value = origin;
  field("release-confirm-pin").value = pin;
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(button("release-load").disabled).toBe(false));
  button("release-load").click();
  await vi.waitFor(() =>
    expect(document.getElementById("release-targets")!.textContent).toContain("maker/tool"),
  );
  expect(button("release-publish").disabled).toBe(true);
  field("release-confirm").checked = true;
  field("release-confirm").dispatchEvent(new Event("change"));
  button("release-publish").click();
  button("release-publish").click();
  await vi.waitFor(() =>
    expect(document.getElementById("release-result")!.textContent).toContain(
      "published successfully",
    ),
  );
  expect(api.request.mock.calls.filter((call) => call[0].endsWith("/publish"))).toHaveLength(1);
  const sent = JSON.stringify(api.request.mock.calls);
  expect(sent).not.toContain(password);
  for (const key of Object.values(backup.keys)) expect(sent).not.toContain(key.privateKey);
  expect(document.getElementById("release-done")!.hidden).toBe(false);
  button("release-lock").click();
  expect(button("release-publish").disabled).toBe(true);
});
it("does not expose setup controls or signing requests to a reviewer without operator access", async () => {
  api.request.mockResolvedValue({ admin: true, operator: false });
  await import("../frontend/src/scripts/release-wizard");
  await vi.waitFor(() =>
    expect(document.getElementById("release-status")!.textContent).toContain("operator account"),
  );
  expect(document.getElementById("release-wizard")!.hidden).toBe(true);
  expect(api.request).toHaveBeenCalledTimes(1);
});
