import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readExtensionWorkspaceFile } from "./extensionWorkspaceRead.ts";

const roots: string[] = [];

function temporary(): string {
  const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-extension-workspace-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) FS.rmSync(root, { recursive: true, force: true });
});

describe("extension workspace file broker", () => {
  it("reads a small UTF-8 file under the authoritative project root", async () => {
    const root = temporary();
    FS.mkdirSync(Path.join(root, "docs"));
    FS.writeFileSync(Path.join(root, "docs", "intro.md"), "Hello, Tabs\n");
    expect(await readExtensionWorkspaceFile(root, "docs/intro.md")).toBe("Hello, Tabs\n");
  });

  it("rejects traversal, absolute paths, and symlinks escaping the project", async () => {
    const root = temporary();
    const outside = temporary();
    FS.writeFileSync(Path.join(outside, "secret.txt"), "secret");
    FS.symlinkSync(outside, Path.join(root, "outside"));
    for (const path of [
      "../secret.txt",
      "/etc/passwd",
      "docs/../../secret.txt",
      "docs\\secret.txt",
      "outside/secret.txt",
    ]) {
      await expect(readExtensionWorkspaceFile(root, path)).rejects.toThrow();
    }
  });

  it("rejects oversized, binary, and non-file targets", async () => {
    const root = temporary();
    FS.writeFileSync(Path.join(root, "large.txt"), Buffer.alloc(1024 * 1024 + 1, 65));
    FS.writeFileSync(Path.join(root, "binary.txt"), Buffer.from([0xff, 0xfe]));
    await expect(readExtensionWorkspaceFile(root, "large.txt")).rejects.toThrow(/large/);
    await expect(readExtensionWorkspaceFile(root, "binary.txt")).rejects.toThrow();
    await expect(readExtensionWorkspaceFile(root, ".")).rejects.toThrow();
  });
});
