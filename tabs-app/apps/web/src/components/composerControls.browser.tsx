import { afterEach, beforeEach, expect, it } from "vitest";
import { openComposerControl } from "~/lib/composerControls";

let clicks: string[] = [];

beforeEach(() => {
  clicks = [];
  document.body.innerHTML = `
    <div data-chat-workspace-controls="true">
      <button aria-label="Workspace mode" id="workspace">Local</button>
      <button aria-label="Branch or worktree" id="branch">main</button>
    </div>
    <button aria-label="Branch or worktree" id="elsewhere">other</button>`;
  for (const id of ["workspace", "branch", "elsewhere"]) {
    document.getElementById(id)!.addEventListener("click", () => clicks.push(id));
  }
});

afterEach(() => {
  document.body.innerHTML = "";
});

it("opens the branch and workspace pickers from the composer toolbar only", () => {
  expect(openComposerControl("branch")).toBe(true);
  expect(openComposerControl("workspace")).toBe(true);
  expect(clicks).toEqual(["branch", "workspace"]);
  expect(document.getElementById("elsewhere")).not.toBe(document.activeElement);
});

it("reports false when the toolbar control is missing or disabled", () => {
  document.getElementById("branch")!.setAttribute("disabled", "");
  expect(openComposerControl("branch")).toBe(false);
  document.body.innerHTML = "<p>no toolbar</p>";
  expect(openComposerControl("workspace")).toBe(false);
});
