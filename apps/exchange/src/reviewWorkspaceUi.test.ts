// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appendReviewWorkspace } from "../frontend/src/scripts/review-workspace";
const digest = "a".repeat(64);
const entry = {
  namespace: "studio",
  name: "relay",
  version: "1.0.0",
  digest,
  status: "review",
  manifest: {
    publisher: "studio",
    name: "relay",
    version: "1.0.0",
    engines: { tabs: ">=2.0.0" },
    capabilities: [],
  },
  scan_result: {
    passed: true,
    digest,
    issues: [],
    files: { "<img src=x onerror=alert(1)>": "b".repeat(64), "dist/index.html": "c".repeat(64) },
    reviewDiff: {
      entries: [{ file: "dist/index.html", change: "added", patch: "+untrusted source" }],
    },
  },
};
let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  document.body.innerHTML = '<div id="parent"></div>';
  writeText = vi.fn(async (_value: string) => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  appendReviewWorkspace(document.getElementById("parent")!, entry, 0);
});
afterEach(() => vi.unstubAllGlobals());
it("supports keyboard tab navigation and renders file names as inert text", () => {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
  tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
  expect(document.activeElement).toBe(tabs[2]);
  expect(tabs[2]!.getAttribute("aria-selected")).toBe("true");
  expect(document.querySelector<HTMLDivElement>('[role="tabpanel"]')!.hidden).toBe(true);
  expect(document.querySelector("img")).toBeNull();
  expect(document.querySelector(".evidence-file-list")!.textContent).toContain("<img src=x");
  const search = document.querySelector<HTMLInputElement>('[type="search"]')!;
  search.value = "dist/index";
  search.dispatchEvent(new Event("input"));
  expect(document.querySelectorAll(".evidence-file-list > li")).toHaveLength(1);
  expect(document.querySelector(".evidence-file-list")!.textContent).not.toContain("<img");
});
it("copies only on demand and includes code only after explicit selection", async () => {
  expect(writeText).not.toHaveBeenCalled();
  const copy = document.querySelector<HTMLButtonElement>(".evidence-workspace-heading button")!;
  copy.click();
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(writeText.mock.calls[0]![0]).not.toContain("+untrusted source");
  document.querySelector<HTMLButtonElement>(".evidence-code-toggle")!.click();
  copy.click();
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
  expect(writeText.mock.calls[1]![0]).toContain("+untrusted source");
  expect(document.querySelector("form")).toBeNull();
});
it("offers a manual text selection when the clipboard is unavailable", async () => {
  writeText.mockRejectedValueOnce(new Error("Denied"));
  document.querySelector<HTMLButtonElement>(".evidence-workspace-heading button")!.click();
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLDetailsElement>(".evidence-brief-preview")!.open).toBe(true),
  );
  const text = document.querySelector<HTMLTextAreaElement>("textarea")!;
  expect(document.activeElement).toBe(text);
  expect(text.value).toContain("READ-ONLY advisory assessment");
  expect(text.readOnly).toBe(true);
});
it("does not copy a retained button after reviewer content is hidden or removed", () => {
  const parent = document.getElementById("parent")!;
  const copy = document.querySelector<HTMLButtonElement>(".evidence-workspace-heading button")!;
  parent.hidden = true;
  copy.click();
  parent.remove();
  copy.click();
  expect(writeText).not.toHaveBeenCalled();
});
