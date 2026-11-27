import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { copyVsceSignModules, findVsceSignScope } from "./code-oss-vsce-sign.ts";

const roots: string[] = [];

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tabs-vsce-sign-"));
  roots.push(root);
  return root;
}

function writePackage(directory: string, files: Record<string, string>): void {
  for (const [name, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    fs.writeFileSync(path.join(directory, name), contents);
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Code-OSS vsce-sign staging", () => {
  it("finds the verifier where pre-1.148 build/ installs linked it", () => {
    const source = makeRoot();
    const scope = path.join(source, "build", "node_modules", "@vscode");
    writePackage(path.join(scope, "vsce-sign"), { "src/main.js": "module.exports = {};" });

    expect(findVsceSignScope(source)).toBe(scope);
  });

  it("copies the 1.148 hidden-hoist links as real directories", () => {
    const source = makeRoot();
    const runtime = makeRoot();
    const store = path.join(source, "build", "node_modules", ".pnpm");
    const signStore = path.join(store, "@vscode+vsce-sign@2.1.1", "node_modules", "@vscode");
    writePackage(path.join(signStore, "vsce-sign"), { "src/main.js": "module.exports = {};" });
    writePackage(path.join(signStore, "vsce-sign-linux-x64"), { "bin/vsce-sign": "binary" });
    const hiddenHoist = path.join(store, "node_modules", "@vscode");
    fs.mkdirSync(hiddenHoist, { recursive: true });
    for (const name of ["vsce-sign", "vsce-sign-linux-x64"]) {
      fs.symlinkSync(path.join(signStore, name), path.join(hiddenHoist, name), "dir");
    }

    expect(copyVsceSignModules(source, runtime).sort()).toEqual([
      "@vscode/vsce-sign",
      "@vscode/vsce-sign-linux-x64",
    ]);
    const staged = path.join(runtime, "node_modules", "@vscode", "vsce-sign");
    expect(fs.lstatSync(staged).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(staged, "src", "main.js"))).toBe(true);
    expect(
      fs.existsSync(path.join(runtime, "node_modules", "@vscode", "vsce-sign-linux-x64", "bin")),
    ).toBe(true);
  });

  it("fails clearly when build/ was never installed", () => {
    expect(() => copyVsceSignModules(makeRoot(), makeRoot())).toThrow(/pnpm --dir build install/);
  });
});
