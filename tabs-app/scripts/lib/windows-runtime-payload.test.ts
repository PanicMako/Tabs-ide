import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyWindowsProductionDependencies,
  finalizeWindowsRuntimePayload,
  includeWindowsCompiledFile,
  readServerRuntimeDependencyPaths,
  stripInlineSourceMap,
  validateProductionDependencyPaths,
  verifyWindowsRuntimePayload,
} from "./windows-runtime-payload";

const temporaryDirectories: string[] = [];
function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tabs-windows-payload-"));
  temporaryDirectories.push(directory);
  return directory;
}
function write(root: string, filename: string, contents: string): string {
  const target = path.join(root, filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("Windows editor production payload", () => {
  it("retains server dependencies classified as development-only at the root", () => {
    const source = temporaryDirectory();
    write(
      source,
      "package.json",
      '{"dependencies":{"desktop":"1"},"devDependencies":{"cookie":"1"}}',
    );
    write(source, "remote/package.json", '{"dependencies":{"desktop":"1","cookie":"1"}}');
    const cookie = path.join(source, "node_modules/cookie");
    write(
      source,
      "node_modules/cookie/package.json",
      '{"dependencies":{"child":"1"},"optionalDependencies":{"not-installed":"1"}}',
    );
    write(source, "node_modules/cookie/node_modules/child/package.json", "{}");
    expect(readServerRuntimeDependencyPaths(source)).toEqual([
      cookie,
      path.join(cookie, "node_modules/child"),
    ]);
    fs.rmSync(path.join(cookie, "node_modules/child"), { recursive: true });
    expect(() => readServerRuntimeDependencyPaths(source)).toThrow("Missing");
  });
  it("copies scoped and nested runtime dependencies without nested dev packages", () => {
    const source = temporaryDirectory();
    const target = temporaryDirectory();
    write(source, "node_modules/@scope/runtime/package.json", '{"name":"@scope/runtime"}');
    write(source, "node_modules/@scope/runtime/native.node", "native binding");
    write(
      source,
      "node_modules/@scope/runtime/node_modules/runtime-child/index.js",
      "export default 1;",
    );
    write(source, "node_modules/@scope/runtime/node_modules/dev-only/index.js", "must not ship");
    write(source, "out-build/nls.messages.json", '["localized text"]');
    write(source, "out-build/nls.messages.js", "globalThis.messages = [];");
    write(source, "out-build/vs/duplicate.js", "must not ship");
    copyWindowsProductionDependencies(source, target, [
      path.join(source, "node_modules/@scope/runtime"),
      path.join(source, "node_modules/@scope/runtime/node_modules/runtime-child"),
    ]);
    expect(
      fs.readFileSync(path.join(target, "node_modules/@scope/runtime/native.node"), "utf8"),
    ).toBe("native binding");
    expect(
      fs.existsSync(
        path.join(target, "node_modules/@scope/runtime/node_modules/runtime-child/index.js"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(target, "node_modules/@scope/runtime/node_modules/dev-only")),
    ).toBe(false);
    expect(fs.readdirSync(path.join(target, "out-build")).sort()).toEqual([
      "nls.messages.js",
      "nls.messages.json",
    ]);
    expect(fs.readFileSync(path.join(target, "out/nls.messages.json"), "utf8")).toBe(
      '["localized text"]',
    );
  });

  it("rejects empty or escaping dependency inventories", () => {
    const source = temporaryDirectory();
    expect(() => validateProductionDependencyPaths(source, [source])).toThrow("empty");
    expect(() =>
      validateProductionDependencyPaths(source, [path.join(source, "../outside")]),
    ).toThrow("outside");
    expect(() =>
      validateProductionDependencyPaths(source, [path.join(source, "node_modules/../../outside")]),
    ).toThrow("outside");
  });

  it("keeps workbench assets while excluding compiled tests and debug output", () => {
    const root = temporaryDirectory();
    for (const entry of [
      "vs/base/test",
      "vs/base/tests/a.js",
      "vs/base/a.js.map",
      "tsconfig.tsbuildinfo",
    ]) {
      expect(includeWindowsCompiledFile(root, path.join(root, entry))).toBe(false);
    }
    expect(includeWindowsCompiledFile(root, path.join(root, "vs/workbench/workbench.js"))).toBe(
      true,
    );
    expect(
      includeWindowsCompiledFile(root, path.join(root, "vs/workbench/contrib/testing/browser.js")),
    ).toBe(true);
  });

  it("strips only the trailing inline source map without changing executable code", () => {
    const executable = 'console.log("sourceMappingURL=data: inside a string");';
    expect(
      stripInlineSourceMap(
        executable + "\n//# sourceMappingURL=data:application/json;base64,e30=\n",
      ),
    ).toBe(executable + "\n");
    expect(
      stripInlineSourceMap(
        executable + "\r\n//# sourceMappingURL=data:application/json;base64,e30=\r\n",
      ),
    ).toBe(executable + "\n");
    expect(stripInlineSourceMap(executable + "\n//# sourceMappingURL=external.js.map\n")).toBe(
      executable + "\n//# sourceMappingURL=external.js.map\n",
    );
    const templateLiteral =
      "const text = `hello\n//# sourceMappingURL=data:application/json;base64,e30=`;\n";
    expect(stripInlineSourceMap(templateLiteral)).toBe(templateLiteral);
  });

  it("reports actual bytes and rejects redundant output after packaging", () => {
    const root = temporaryDirectory();
    const javascript = write(
      root,
      "out/server-main.js",
      "console.log(1);\n//# sourceMappingURL=data:application/json;base64,e30=\n",
    );
    write(root, "out-build/nls.messages.json", '["hello"]');
    const report = finalizeWindowsRuntimePayload(root);
    expect(report.files).toBe(2);
    expect(report.sourceMapBytesRemoved).toBeGreaterThan(0);
    expect(report.bytes).toBe(fs.statSync(javascript).size + Buffer.byteLength('["hello"]'));
    expect(() => verifyWindowsRuntimePayload(root)).not.toThrow();
    write(root, "out-build/vs/duplicate.js", "duplicate");
    expect(() => verifyWindowsRuntimePayload(root)).toThrow("Redundant");
  });
});
