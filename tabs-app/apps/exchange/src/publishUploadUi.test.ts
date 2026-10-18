// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ request: vi.fn() }));
const upload = vi.hoisted(() => ({ package: vi.fn() }));
vi.mock("../frontend/src/scripts/api", () => ({ request: api.request, csrfToken: () => "test" }));
vi.mock("../frontend/src/scripts/upload", async (original) => ({
  ...(await original<typeof import("../frontend/src/scripts/upload")>()),
  uploadPackage: upload.package,
}));
let listeners: Array<[string, EventListenerOrEventListenerObject]> = [];
beforeEach(() => {
  listeners = [];
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
    if (listener) listeners.push([type, listener]);
    add(type, listener, options);
  });
  vi.resetModules();
  api.request.mockReset();
  upload.package.mockReset();
  document.body.innerHTML = `<form id="publish-form"><fieldset id="publish-fields" disabled><select id="publish-namespace"><option value="">Choose namespace</option></select><input id="publish-agreement" type="checkbox"><div id="publish-drop"><input id="publish-file" type="file"><p id="publish-file-summary"></p></div><button type="submit" disabled>Submit</button></fieldset></form><p id="publish-status"></p><progress id="publish-progress"></progress><button id="publish-cancel"></button><p id="publish-terms"></p>`;
});

it("does not send a package when cancelled while terms acceptance is pending", async () => {
  let finishAgreement!: () => void;
  api.request
    .mockResolvedValueOnce({ publishingEnabled: true, termsVersion: "test" })
    .mockResolvedValueOnce({ termsVersion: "test", acceptedAt: null })
    .mockResolvedValueOnce({ namespaces: [{ name: "maker", role: "owner" }] })
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishAgreement = resolve;
        }),
    );
  await import("../frontend/src/scripts/publish");
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLFieldSetElement>("#publish-fields")!.disabled).toBe(false),
  );
  document.querySelector<HTMLSelectElement>("#publish-namespace")!.value = "maker";
  document.querySelector<HTMLInputElement>("#publish-agreement")!.checked = true;
  const input = document.querySelector<HTMLInputElement>("#publish-file")!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["test"], "tool.tabsext")],
  });
  input.dispatchEvent(new Event("change"));
  document.querySelector("#publish-form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(api.request).toHaveBeenCalledTimes(4));
  const cancel = document.querySelector<HTMLButtonElement>("#publish-cancel")!;
  expect(cancel.hidden).toBe(false);
  cancel.click();
  finishAgreement();
  await vi.waitFor(() => expect(cancel.hidden).toBe(true));
  expect(upload.package).not.toHaveBeenCalled();
  expect(document.querySelector("#publish-status")!.textContent).toBe(
    "Upload cancelled before the package was sent.",
  );
  expect(document.querySelector<HTMLProgressElement>("#publish-progress")!.hidden).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  for (const [type, listener] of listeners) window.removeEventListener(type, listener);
  vi.restoreAllMocks();
});
it("reflects valid file selection without treating selection as submission or accepting invalid files", async () => {
  api.request
    .mockResolvedValueOnce({ publishingEnabled: true, termsVersion: "test" })
    .mockResolvedValueOnce({ termsVersion: "test", acceptedAt: null })
    .mockResolvedValueOnce({ namespaces: [{ name: "maker", role: "owner" }] });
  await import("../frontend/src/scripts/publish");
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLFieldSetElement>("#publish-fields")!.disabled).toBe(false),
  );
  const input = document.querySelector<HTMLInputElement>("#publish-file")!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["test"], "my-tool.tabsext")],
  });
  input.dispatchEvent(new Event("change"));
  expect(document.querySelector<HTMLElement>("#publish-drop")!.dataset.selected).toBe("true");
  expect(document.querySelector("#publish-file-summary")!.textContent).toContain("my-tool.tabsext");
  expect(document.querySelector("#publish-file-summary")!.textContent).toContain("4 B");
  expect(api.request).toHaveBeenCalledTimes(3);
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["test"], "wrong.zip")],
  });
  input.dispatchEvent(new Event("change"));
  expect(document.querySelector<HTMLElement>("#publish-drop")!.dataset.selected).toBe("false");
  expect(document.querySelector("#publish-file-summary")!.textContent).toBe("");
});
it("does not advertise an active drop target when publishing prerequisites fail", async () => {
  api.request.mockResolvedValueOnce(null);
  await import("../frontend/src/scripts/publish");
  const drop = document.querySelector<HTMLElement>("#publish-drop")!;
  drop.dispatchEvent(new Event("dragover", { cancelable: true }));
  expect(drop.dataset.dragging).toBeUndefined();
  expect(document.querySelector<HTMLFieldSetElement>("#publish-fields")!.disabled).toBe(true);
  expect(document.querySelector("#publish-status")!.textContent).toContain("Sign in");
});

it("requires every prerequisite and clears a previously valid package after a multiple-file drop", async () => {
  api.request
    .mockResolvedValueOnce({ publishingEnabled: true, termsVersion: "test" })
    .mockResolvedValueOnce({ termsVersion: "test", acceptedAt: null })
    .mockResolvedValueOnce({ namespaces: [{ name: "maker", role: "owner" }] });
  await import("../frontend/src/scripts/publish");
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLFieldSetElement>("#publish-fields")!.disabled).toBe(false),
  );
  const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const namespace = document.querySelector<HTMLSelectElement>("#publish-namespace")!;
  const agreement = document.querySelector<HTMLInputElement>("#publish-agreement")!;
  const input = document.querySelector<HTMLInputElement>("#publish-file")!;
  const drop = document.querySelector<HTMLElement>("#publish-drop")!;
  const file = new File(["test"], "tool.tabsext");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change"));
  expect(submit.disabled).toBe(true);
  namespace.value = "maker";
  namespace.dispatchEvent(new Event("change"));
  expect(submit.disabled).toBe(true);
  agreement.checked = true;
  agreement.dispatchEvent(new Event("change"));
  expect(submit.disabled).toBe(false);
  agreement.checked = false;
  agreement.dispatchEvent(new Event("change"));
  expect(submit.disabled).toBe(true);
  agreement.checked = true;
  agreement.dispatchEvent(new Event("change"));
  const event = new Event("drop", { cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files: [file, file] } });
  drop.dispatchEvent(event);
  expect(submit.disabled).toBe(true);
  expect(drop.dataset.selected).toBe("false");
  expect(document.querySelector("#publish-file-summary")!.textContent).toBe("");
  expect(document.querySelector("#publish-status")!.textContent).toBe("Drop exactly one package.");
  document.querySelector("#publish-form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(api.request).toHaveBeenCalledTimes(3);
});

it("reuses the server-recorded current terms acceptance on a subsequent package upload", async () => {
  api.request
    .mockResolvedValueOnce({ publishingEnabled: true, termsVersion: "test" })
    .mockResolvedValueOnce({ termsVersion: "test", acceptedAt: "2026-10-01T00:00:00Z" })
    .mockResolvedValueOnce({ namespaces: [{ name: "maker", role: "owner" }] });
  upload.package.mockRejectedValue(new Error("Controlled upload failure"));
  await import("../frontend/src/scripts/publish");
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLFieldSetElement>("#publish-fields")!.disabled).toBe(false),
  );
  document.querySelector<HTMLSelectElement>("#publish-namespace")!.value = "maker";
  expect(document.querySelector<HTMLInputElement>("#publish-agreement")!.checked).toBe(true);
  const input = document.querySelector<HTMLInputElement>("#publish-file")!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["test"], "tool.tabsext")],
  });
  input.dispatchEvent(new Event("change"));
  document.querySelector("#publish-form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(upload.package).toHaveBeenCalledTimes(1));
  expect(api.request).toHaveBeenCalledTimes(3);
  expect(api.request).not.toHaveBeenCalledWith(
    "/v1/publisher/agreement",
    "POST",
    expect.anything(),
  );
});

it("keeps preparation editable while uploads are closed without accepting terms or uploading", async () => {
  document.body.insertAdjacentHTML(
    "beforeend",
    '<p id="publish-gate-title"></p><p id="publish-submit-note"></p><div id="publish-agreement-panel"></div><button id="publish-remove-file" hidden></button>',
  );
  api.request
    .mockResolvedValueOnce({ publishingEnabled: false, termsVersion: "test" })
    .mockResolvedValueOnce({ termsVersion: "test", acceptedAt: null })
    .mockResolvedValueOnce({
      namespaces: [
        { name: "maker", role: "owner" },
        { name: "studio", role: "contributor" },
      ],
    });
  await import("../frontend/src/scripts/publish");
  const fields = document.querySelector<HTMLFieldSetElement>("#publish-fields")!;
  await vi.waitFor(() => expect(fields.disabled).toBe(false));
  const namespace = document.querySelector<HTMLSelectElement>("#publish-namespace")!;
  namespace.value = "studio";
  namespace.dispatchEvent(new Event("change"));
  const input = document.querySelector<HTMLInputElement>("#publish-file")!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["test"], "tool.tabsext")],
  });
  input.dispatchEvent(new Event("change"));
  document.querySelector<HTMLInputElement>("#publish-agreement")!.checked = true;
  document.querySelector("#publish-form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  expect(document.querySelector("#publish-submit-note")!.textContent).toContain(
    "Uploads are not open yet",
  );
  expect(document.querySelector<HTMLElement>("#publish-agreement-panel")!.hidden).toBe(true);
  expect(api.request).toHaveBeenCalledTimes(3);
  expect(upload.package).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>("#publish-remove-file")!.click();
  expect(document.querySelector<HTMLElement>("#publish-drop")!.dataset.selected).toBe("false");
  expect(document.querySelector("#publish-file-summary")!.textContent).toBe("");
});
it("selects a sole namespace and rejects oversized files during preparation", async () => {
  api.request
    .mockResolvedValueOnce({ publishingEnabled: false, termsVersion: "test" })
    .mockResolvedValueOnce({ termsVersion: "test", acceptedAt: null })
    .mockResolvedValueOnce({ namespaces: [{ name: "maker", role: "owner" }] });
  await import("../frontend/src/scripts/publish");
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLFieldSetElement>("#publish-fields")!.disabled).toBe(false),
  );
  expect(document.querySelector<HTMLSelectElement>("#publish-namespace")!.value).toBe("maker");
  const input = document.querySelector<HTMLInputElement>("#publish-file")!;
  const file = new File(["test"], "large.tabsext");
  Object.defineProperty(file, "size", { value: 25 * 1024 * 1024 + 1 });
  Object.defineProperty(input, "files", { value: [file] });
  input.dispatchEvent(new Event("change"));
  expect(document.querySelector("#publish-status")!.textContent).toContain("25 MiB");
  expect(document.querySelector<HTMLElement>("#publish-status")!.dataset.state).toBe("error");
  expect(document.querySelector<HTMLElement>("#publish-drop")!.dataset.selected).toBe("false");
  expect(upload.package).not.toHaveBeenCalled();
});
it("discards account initialization after leaving the page", async () => {
  let finish!: (value: unknown) => void;
  api.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await import("../frontend/src/scripts/publish");
  window.dispatchEvent(new Event("pagehide"));
  finish({ publishingEnabled: true, termsVersion: "test" });
  await Promise.resolve();
  expect(document.querySelector<HTMLFieldSetElement>("#publish-fields")!.disabled).toBe(true);
  expect(api.request).toHaveBeenCalledTimes(1);
});
