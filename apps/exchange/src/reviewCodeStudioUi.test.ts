// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createReviewCodeStudio } from "../frontend/src/scripts/review-code-studio";
const digest = "a".repeat(64);
const source = Array.from({ length: 230 }, (_, i) =>
  i === 202 ? 'const target = "<img src=x onerror=alert(1)>";' : `const line${i + 1} = ${i + 1};`,
).join("\n");
let fetcher: ReturnType<typeof vi.fn>;
let useNotes = vi.fn((_text: string) => {});
let trigger: HTMLButtonElement;
let owner: HTMLElement;
let open: (trigger: HTMLElement) => void;
function click(text: string) {
  [...document.querySelectorAll<HTMLButtonElement>(".review-code-studio button")]
    .find((value) => value.textContent === text)!
    .click();
}
beforeEach(() => {
  document.body.innerHTML = '<div id="owner"></div><button id="trigger">Review code</button>';
  owner = document.getElementById("owner")!;
  trigger = document.getElementById("trigger") as HTMLButtonElement;
  fetcher = vi.fn(async (path: string) => {
    const file = new URL(path, "http://local").searchParams.get("file")!;
    return new Response(
      JSON.stringify({
        digest,
        file,
        bytes: 10000,
        sha256: "b".repeat(64),
        text: file === "tabs-extension.json" ? '{"name": "Relay"}' : source,
      }),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => {}) } });
  useNotes = vi.fn((_text: string) => {});
  open = createReviewCodeStudio({
    entry: {
      namespace: "studio",
      name: "relay",
      version: "1.0.0",
      digest,
      status: "review",
      manifest: {},
      scan_result: null,
    },
    files: [
      ["tabs-extension.json", "b".repeat(64)],
      ["src/main.js", "b".repeat(64)],
    ],
    changes: new Map(),
    owner,
    onUseNotes: useNotes,
  });
});
afterEach(() => {
  document
    .querySelector<HTMLElement>(".review-code-studio")
    ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  vi.unstubAllGlobals();
});
it("opens a keyboard-contained explorer with colored inert source and restores focus on close", async () => {
  open(trigger);
  await vi.waitFor(() => expect(document.querySelector(".syntax-property")).not.toBeNull());
  expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
  expect(owner.inert).toBe(true);
  expect(document.querySelector("script,img,iframe")).toBeNull();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Find a package file");
  document
    .querySelector('[aria-label="Read src/main.js"]')!
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() =>
    expect(document.querySelector(".studio-code-status")!.textContent).toContain("Verified"),
  );
  expect(document.querySelector(".studio-file-tabs")!.textContent).toContain("main.js");
  document
    .querySelector<HTMLElement>(".review-code-studio")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(owner.inert).toBe(false);
  expect(document.activeElement).toBe(trigger);
});
it("finds code across pages and anchors a suggestion to its original file despite switching tabs", async () => {
  open(trigger);
  document.querySelector<HTMLButtonElement>('[aria-label="Read src/main.js"]')!.click();
  await vi.waitFor(() =>
    expect(document.querySelector(".studio-code-status")!.textContent).toContain("Verified"),
  );
  const find = document.querySelector<HTMLInputElement>('[aria-label="Find in code"]')!;
  find.value = "target";
  find.dispatchEvent(new Event("input"));
  find.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(document.querySelector('.studio-line[data-line="203"]')!.textContent).toContain("<img");
  expect(document.querySelector("img")).toBeNull();
  click("Suggest change");
  const comment = document.querySelector<HTMLTextAreaElement>(".studio-notes textarea")!;
  comment.value = "Avoid this unsafe markup";
  const replacement = document.querySelectorAll<HTMLTextAreaElement>(".studio-notes textarea")[1]!;
  replacement.value = 'const target = "safe";';
  document.querySelector<HTMLButtonElement>('[aria-label="Open tabs-extension.json"]')!.click();
  click("Save draft note");
  expect(document.querySelector(".studio-note-list")!.textContent).toContain("src/main.js:203–203");
  expect(useNotes).not.toHaveBeenCalled();
  click("Use notes in decision");
  expect(useNotes).toHaveBeenCalledOnce();
  expect(useNotes.mock.calls[0]![0]).toContain("Suggested replacement (not applied)");
  expect(fetcher.mock.calls.every((call) => (call[1] as RequestInit)?.method === "GET")).toBe(true);
});
it("closes and aborts when its reviewer owner is removed", async () => {
  open(trigger);
  owner.remove();
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  expect(trigger.inert).toBe(false);
});
it("keeps Tab inside the dialog and retains draft notes when closed and reopened", async () => {
  open(trigger);
  await vi.waitFor(() => expect(document.querySelector(".syntax-property")).not.toBeNull());
  const first = [...document.querySelectorAll<HTMLButtonElement>(".studio-top button")][0]!;
  first.focus();
  first.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }),
  );
  expect(document.querySelector(".review-code-studio")!.contains(document.activeElement)).toBe(
    true,
  );
  expect(document.activeElement).not.toBe(first);
  click("Add note");
  document.querySelector<HTMLTextAreaElement>(".studio-notes textarea")!.value =
    "Check the declared identity";
  click("Save draft note");
  click("Close review ×");
  open(trigger);
  expect(document.querySelector(".studio-note-list")!.textContent).toContain(
    "Check the declared identity",
  );
});
