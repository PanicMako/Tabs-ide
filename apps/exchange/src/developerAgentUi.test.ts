// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const page = readFileSync(
  join(import.meta.dirname, "../frontend/src/pages/developers.astro"),
  "utf8",
);
const textarea = page.match(/<textarea[^>]*id="agent-instructions"[^>]*>[\s\S]*?<\/textarea>/)?.[0];
if (!textarea) throw new Error("Missing developer agent instructions field");

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = `<button id="agent-copy">Copy agent instructions</button>${textarea}<p id="agent-copy-status" role="status"></p>`;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("copies the displayed, origin-specific instructions and preserves manual publication", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await import("../frontend/src/scripts/developer-agent");
  const instructions = document.querySelector<HTMLTextAreaElement>("#agent-instructions")!;
  expect(instructions.value).toContain(`${location.origin}/developers/releases/manifest.json`);
  expect(instructions.value).toContain("verify the declared SHA-256");
  expect(instructions.value).toContain("Do not upload or publish unless I ask");
  document.querySelector<HTMLButtonElement>("#agent-copy")!.click();
  await vi.waitFor(() =>
    expect(document.querySelector("#agent-copy-status")!.textContent).toContain("Copied."),
  );
  expect(writeText).toHaveBeenCalledExactlyOnceWith(instructions.value);
});
it("offers selected, focused instructions when clipboard access is denied", async () => {
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) },
  });
  await import("../frontend/src/scripts/developer-agent");
  document.querySelector<HTMLButtonElement>("#agent-copy")!.click();
  const instructions = document.querySelector<HTMLTextAreaElement>("#agent-instructions")!;
  await vi.waitFor(() => expect(document.activeElement).toBe(instructions));
  expect(instructions.selectionStart).toBe(0);
  expect(instructions.selectionEnd).toBe(instructions.value.length);
  expect(document.querySelector("#agent-copy-status")!.textContent).toContain("Select and copy");
});

it("lets developers edit the advertised editable instructions before copying", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await import("../frontend/src/scripts/developer-agent");
  const instructions = document.querySelector<HTMLTextAreaElement>("#agent-instructions")!;
  expect(instructions.readOnly).toBe(false);
  instructions.value = instructions.value.replace(
    "[describe what you want to build]",
    "A project handoff tool",
  );
  document.querySelector<HTMLButtonElement>("#agent-copy")!.click();
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(instructions.value));
  expect(instructions.value).toContain("My extension idea: A project handoff tool");
});
