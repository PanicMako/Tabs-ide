// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
let uploads: Upload[];
class Upload {
  status = 200;
  responseText = "";
  upload = {};
  onload!: () => void;
  onerror!: () => void;
  onabort!: () => void;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  constructor() {
    uploads.push(this);
  }
}
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
beforeEach(async () => {
  vi.resetModules();
  uploads = [];
  const html = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "publisher.html"),
    "utf8",
  );
  document.body.innerHTML = /<body[^>]*>([\s\S]*?)<\/body>/.exec(html)![1]!;
  vi.stubGlobal("XMLHttpRequest", Upload);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      Response.json(
        path === "/v1/me"
          ? {
              login: "publisher",
              publishingEnabled: true,
              termsVersion: "test",
              admin: false,
            }
          : { tokens: [], namespaces: [], invitations: [], submissions: [], appeals: [] },
      ),
    ),
  );
  await import("./publisher.js");
  await vi.waitFor(() => expect(element<HTMLInputElement>("upload-file").disabled).toBe(false));
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function submit(size = 3) {
  Object.defineProperty(element("upload-file"), "files", {
    configurable: true,
    value: [new File([new Uint8Array(size)], "tool.tabsext")],
  });
  element("upload-form").dispatchEvent(new Event("submit", { cancelable: true }));
}
it("prevents duplicate upload and conceals completed progress", async () => {
  submit();
  submit();
  expect(uploads).toHaveLength(1);
  uploads[0]!.responseText = JSON.stringify({ version: "1.0.0", digest: "a".repeat(64) });
  uploads[0]!.onload();
  await vi.waitFor(() => expect(element("upload-progress").hidden).toBe(true));
  expect(element("status").textContent).toContain("Submitted version 1.0.0");
});
it.each(["onerror", "onabort"] as const)(
  "warns to inspect immutable submissions after %s",
  async (event) => {
    submit();
    uploads[0]![event]();
    await vi.waitFor(() =>
      expect(element("status").textContent).toContain("Refresh submissions before retrying"),
    );
    expect(element("upload-progress").hidden).toBe(true);
  },
);
it("redacts upstream diagnostics and preserves access guidance", async () => {
  submit();
  uploads[0]!.status = 403;
  uploads[0]!.responseText = JSON.stringify({ error: "private upstream diagnostic" });
  uploads[0]!.onload();
  await vi.waitFor(() => expect(element("status").textContent).toContain("namespace membership"));
  expect(element("status").textContent).not.toContain("private upstream");
});
it("rejects an oversized response and an empty archive", async () => {
  submit(0);
  expect(uploads).toHaveLength(0);
  submit();
  uploads[0]!.responseText = "a".repeat(1024 * 1024 + 1);
  uploads[0]!.onload();
  await vi.waitFor(() =>
    expect(element("status").textContent).toContain("response exceeded its limit"),
  );
});
