import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createExtensionStarter } from "./starter.ts";
import { inspectTabsext, packTabsext, validateTabsextDirectory } from "./index.ts";

const roots: string[] = [];
function target() {
  const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-starter-test-"));
  roots.push(root);
  return { root, directory: Path.join(root, "my-tool") };
}
afterEach(() => {
  for (const root of roots.splice(0)) FS.rmSync(root, { recursive: true, force: true });
});
it("creates a zero-permission starter that validates and packages", async () => {
  const { root, directory } = target();
  createExtensionStarter(directory, "my-publisher", "my-tool");
  expect(validateTabsextDirectory(directory, "1.3.17").id).toBe("my-publisher.my-tool");
  const archive = Path.join(root, "tool.tabsext");
  await packTabsext({ directory, destination: archive, tabsVersion: "1.3.17" });
  const inspected = await inspectTabsext(archive, "1.3.17");
  expect(inspected.manifest.capabilities).toBeUndefined();
  expect(inspected.files).toContain("dist/app.js");
});
it("refuses existing folders without modifying their contents", () => {
  const { directory } = target();
  FS.mkdirSync(directory);
  FS.writeFileSync(Path.join(directory, "keep.txt"), "unchanged");
  expect(() => createExtensionStarter(directory, "example", "tool")).toThrow();
  expect(FS.readdirSync(directory)).toEqual(["keep.txt"]);
});
it("rejects invalid identities before creating files", () => {
  const { directory } = target();
  for (const invalid of ["../bad", "Bad", "<script>", "", "a".repeat(65)]) {
    expect(() => createExtensionStarter(directory, invalid, "tool")).toThrow();
    expect(() => createExtensionStarter(directory, "example", invalid)).toThrow();
  }
  expect(FS.existsSync(directory)).toBe(false);
});
it("does not follow an existing destination symlink", () => {
  const { root, directory } = target();
  FS.symlinkSync(root, directory, "dir");
  expect(() => createExtensionStarter(directory, "example", "tool")).toThrow();
  expect(FS.existsSync(Path.join(root, "tabs-extension.json"))).toBe(false);
});
