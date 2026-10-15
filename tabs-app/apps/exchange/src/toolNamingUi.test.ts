// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../frontend/src/scripts/api", () => ({ request: api.request }));
beforeEach(() => {
  vi.resetModules();
  api.request.mockReset();
  document.body.innerHTML = `<select id="publish-namespace"><option value="studio">Studio</option><option value="team">Team</option></select><input id="tool-display-name"><input id="tool-package-name"><button id="tool-name-check"></button><a id="tool-name-search"></a><p id="tool-name-status"></p><div id="tool-name-selection" hidden><strong id="tool-name-title"></strong><code id="tool-name-id"></code><pre id="tool-name-manifest"></pre><button id="tool-name-copy"></button></div>`;
});
function input(id: string, value: string) {
  const node = document.getElementById(id) as HTMLInputElement;
  node.value = value;
  node.dispatchEvent(new Event("input"));
}
const status = () => document.getElementById("tool-name-status")!.textContent;
const check = () => document.getElementById("tool-name-check")!.click();
it.each([true, false])(
  "distinguishes a new tool from an existing tool (available=%s)",
  async (available) => {
    await import("../frontend/src/scripts/tool-naming");
    input("tool-display-name", "Simulators");
    api.request.mockResolvedValue({ namespace: "studio", name: "simulators", available });
    check();
    await vi.waitFor(() =>
      expect(status()).toContain(
        available ? "available in your namespace right now" : "already exists",
      ),
    );
    expect(api.request.mock.calls[0]![0]).toBe(
      "/v1/publisher/name-check?namespace=studio&name=simulators",
    );
    expect(JSON.parse(document.getElementById("tool-name-manifest")!.textContent!)).toEqual({
      publisher: "studio",
      name: "simulators",
      displayName: "Simulators",
    });
    expect(document.getElementById("tool-name-search")!.getAttribute("href")).toBe(
      "/extensions?q=Simulators",
    );
  },
);
it("invalidates pending results when the publisher or name changes", async () => {
  await import("../frontend/src/scripts/tool-naming");
  input("tool-display-name", "Simulators");
  let resolve!: (value: unknown) => void;
  api.request.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  check();
  const signal = api.request.mock.calls[0]![3] as AbortSignal;
  const namespace = document.getElementById("publish-namespace") as HTMLSelectElement;
  namespace.value = "team";
  namespace.dispatchEvent(new Event("change"));
  resolve({ namespace: "studio", name: "simulators", available: true });
  await Promise.resolve();
  expect(signal.aborted).toBe(true);
  expect(status()).not.toContain("available in your namespace right now");
  expect(document.getElementById("tool-name-selection")!.hidden).toBe(true);
});
it("keeps explicit slugs and handles invalid inputs and unexpected responses", async () => {
  await import("../frontend/src/scripts/tool-naming");
  input("tool-package-name", "my-tool");
  input("tool-display-name", "Simulators");
  expect((document.getElementById("tool-package-name") as HTMLInputElement).value).toBe("my-tool");
  input("tool-package-name", "Bad.Name");
  check();
  expect(api.request).not.toHaveBeenCalled();
  expect(document.activeElement?.id).toBe("tool-package-name");
  input("tool-package-name", "my-tool");
  api.request.mockResolvedValue({ namespace: "other", name: "my-tool", available: true });
  check();
  await vi.waitFor(() => expect(status()).toContain("unexpected name check"));
  expect(document.getElementById("tool-name-selection")!.hidden).toBe(true);
});
