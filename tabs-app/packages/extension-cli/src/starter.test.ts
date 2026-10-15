import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { validateTabsextDirectory, packTabsext, inspectTabsext } from "@tabs/extension-package";
import { initProject } from "./starter.ts";

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) FS.rmSync(path, { recursive: true, force: true });
});
function directory() {
  const path = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-cli-test-"));
  temporary.push(path);
  return path;
}

it("builds and packages only staged HTML assets, not developer secrets", async () => {
  const root = directory();
  const project = Path.join(root, "my-tool");
  initProject(project, { publisher: "my-publisher", name: "my-tool", template: "html" });
  FS.writeFileSync(Path.join(project, ".env"), "SECRET=not-packaged");
  execFileSync(process.execPath, ["scripts/stage.mjs"], { cwd: project });
  const stage = Path.join(project, ".tabs-extension");
  expect(validateTabsextDirectory(stage, "1.3.17").id).toBe("my-publisher.my-tool");
  const archive = Path.join(root, "tool.tabsext");
  await packTabsext({ directory: stage, destination: archive, tabsVersion: "1.3.17" });
  const result = await inspectTabsext(archive, "1.3.17");
  expect(result.manifest.listing?.readme).toBe("README.md");
  expect(FS.readdirSync(stage).sort()).toEqual(["README.md", "dist", "tabs-extension.json"]);
});

it("uses the real identity validator before creating a directory and never overwrites", () => {
  const root = directory();
  const project = Path.join(root, "tool");
  for (const name of ["a", "a".repeat(64), "../escape"]) {
    expect(() =>
      initProject(project, { publisher: "publisher", name, template: "html" }),
    ).toThrow();
    expect(FS.existsSync(project)).toBe(false);
  }
  initProject(project, { publisher: "publisher", name: "a".repeat(63), template: "html" });
  expect(() =>
    initProject(project, { publisher: "publisher", name: "other", template: "react" }),
  ).toThrow();
  expect(JSON.parse(FS.readFileSync(Path.join(project, "tabs-extension.json"), "utf8")).name).toBe(
    "a".repeat(63),
  );
});
