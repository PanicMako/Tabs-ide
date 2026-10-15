import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { readExtensionGitStatus } from "./extensionGitStatus.ts";

const roots: string[] = [];

function repository(): string {
  const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-extension-git-test-"));
  roots.push(root);
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=Tabs Test",
    "-c",
    "user.email=tabs@example.test",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "Initial",
  ]);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) FS.rmSync(root, { recursive: true, force: true });
});

describe("extension Git status broker", () => {
  it("returns only branch and dirty state for the authoritative project root", async () => {
    const root = repository();
    const clean = await readExtensionGitStatus(root);
    expect(clean.branch).toBeTruthy();
    expect(clean.dirty).toBe(false);
    FS.writeFileSync(Path.join(root, "untracked.txt"), "change");
    expect(await readExtensionGitStatus(root)).toEqual({ branch: clean.branch, dirty: true });
  });

  it("does not treat changes outside a nested project as its own", async () => {
    const root = repository();
    FS.mkdirSync(Path.join(root, "project"));
    FS.writeFileSync(Path.join(root, "outside.txt"), "change");
    const status = await readExtensionGitStatus(Path.join(root, "project"));
    expect(status.dirty).toBe(false);
  });

  it("rejects a non-repository without returning files or Git output", async () => {
    const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-extension-no-git-"));
    roots.push(root);
    await expect(readExtensionGitStatus(root)).rejects.toThrow();
  });
});
