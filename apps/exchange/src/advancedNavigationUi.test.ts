// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";

const html = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "publisher.html"),
  "utf8",
);
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([
  { admin: false, operator: false },
  { admin: true, operator: false },
  { admin: true, operator: true },
])("only exposes Advanced shortcuts for the signed-in role: %j", async (role) => {
  vi.resetModules();
  document.body.innerHTML = /<body[^>]*>([\s\S]*?)<\/body>/.exec(html)![1]!;
  document
    .getElementById("signed-in")!
    .insertAdjacentHTML(
      "beforeend",
      '<section id="advanced-reviewer-tools" hidden><a id="advanced-operator-link" hidden href="/admin/reviewers">Reviewer access</a></section>',
    );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      Response.json(
        path === "/v1/me"
          ? { login: "publisher", publishingEnabled: true, termsVersion: "test", ...role }
          : {
              tokens: [],
              namespaces: [],
              invitations: [],
              submissions: [],
              appeals: [],
              versions: [],
              blockedDigests: [],
              metadataFreshness: [],
              pendingRevocations: [],
            },
      ),
    ),
  );
  await import("./publisher.js");
  await vi.waitFor(() => expect(document.getElementById("signed-in")!.hidden).toBe(false));
  expect(document.getElementById("advanced-reviewer-tools")!.hidden).toBe(!role.admin);
  expect(document.getElementById("advanced-operator-link")!.hidden).toBe(!role.operator);
  expect(document.getElementById("review-section")!.hidden).toBe(!role.admin);
  expect(document.getElementById("blocked-digests-section")!.hidden).toBe(!role.admin);
});
