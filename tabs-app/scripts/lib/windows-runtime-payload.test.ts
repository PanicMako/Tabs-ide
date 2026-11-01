import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyWindowsProductionDependencies,
  finalizeWindowsRuntimePayload,
  hasUnacceptableNpmLsErrors,
  includeWindowsCompiledFile,
  readAdditionalRuntimeDependencyPaths,
  stripInlineSourceMap,
  validateProductionDependencyPaths,
  verifyWindowsRuntimePayload,
  WINDOWS_RUNTIME_FILE_FILTER,
  verifyWindowsTypeScriptLibraries,
} from "./windows-runtime-payload";

const temporaryDirectories: string[] = [];

it("retains TypeScript standard libraries through electron-builder's runtime filter", () => {
  const require = createRequire(import.meta.url);
  const builderRequire = createRequire(require.resolve("electron-builder/package.json"));
  const { FileMatcher } = builderRequire("app-builder-lib/out/fileMatcher.js") as {
    FileMatcher: new (
      from: string,
      to: string,
      expand: (value: string) => string,
      patterns: string[],
    ) => { createFilter(): (filename: string, stat: fs.Stats) => boolean };
  };
  const root = temporaryDirectory();
  const filter = new FileMatcher(
    root,
    root,
    (value) => value,
    WINDOWS_RUNTIME_FILE_FILTER,
  ).createFilter();
  for (const name of ["typescript.js", "lib.d.ts", "lib.es5.d.ts", "lib.dom.d.ts"]) {
    const filename = write(root, `extensions/node_modules/typescript/lib/${name}`, "library");
    expect(filter(filename, fs.statSync(filename))).toBe(true);
  }
  const source = write(root, "extensions/example/src/extension.ts", "development source");
  expect(filter(source, fs.statSync(source))).toBe(false);
});

it("rejects incomplete prepackaged TypeScript libraries before producing an installer", () => {
  const root = temporaryDirectory();
  for (const name of ["lib.d.ts", "lib.es5.d.ts", "lib.dom.d.ts"]) {
    expect(() => verifyWindowsTypeScriptLibraries(root)).toThrow(name);
    write(root, `extensions/node_modules/typescript/lib/${name}`, "declaration");
  }
  expect(() => verifyWindowsTypeScriptLibraries(root)).not.toThrow();
});

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
    expect(readAdditionalRuntimeDependencyPaths(source)).toEqual([
      cookie,
      path.join(cookie, "node_modules/child"),
    ]);
    fs.rmSync(path.join(cookie, "node_modules/child"), { recursive: true });
    expect(() => readAdditionalRuntimeDependencyPaths(source)).toThrow("Missing");
  });
  it("preserves the embedded Claude SDK and installed native dependencies", () => {
    const source = temporaryDirectory();
    write(source, "package.json", '{"devDependencies":{"@anthropic-ai/claude-agent-sdk":"1"}}');
    write(
      source,
      "node_modules/@anthropic-ai/claude-agent-sdk/package.json",
      '{"optionalDependencies":{"@anthropic-ai/claude-agent-sdk-win32-x64":"1","not-installed":"1"}}',
    );
    write(source, "node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/package.json", "{}");
    expect(readAdditionalRuntimeDependencyPaths(source)).toEqual([
      path.join(source, "node_modules/@anthropic-ai/claude-agent-sdk"),
      path.join(source, "node_modules/@anthropic-ai/claude-agent-sdk-win32-x64"),
    ]);
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
    write(root, "extensions/example/keyboard.map", "runtime asset");
    write(root, "extensions/copilot/node_modules/telemetry/dist/index.js.map", "debug data");
    write(root, "node_modules/example/build.tsbuildinfo", "build cache");
    const report = finalizeWindowsRuntimePayload(root);
    expect(report.files).toBe(3);
    expect(
      fs.existsSync(path.join(root, "extensions/copilot/node_modules/telemetry/dist/index.js.map")),
    ).toBe(false);
    expect(report.sourceMapBytesRemoved).toBeGreaterThan(0);
    expect(report.bytes).toBe(
      fs.statSync(javascript).size + Buffer.byteLength('["hello"]runtime asset'),
    );
    expect(() => verifyWindowsRuntimePayload(root)).not.toThrow();
    write(root, "out-build/vs/duplicate.js", "duplicate");
    expect(() => verifyWindowsRuntimePayload(root)).toThrow("Redundant");
  });

  it("accepts ELSPROBLEMS inventories with invalid and extraneous packages while rejecting missing dependencies", () => {
    const validErrors = [
      "npm error code ELSPROBLEMS",
      "npm error invalid: @microsoft/dev-tunnels-ssh-tcp@3.12.22 D:\\a\\Tabs-ide\\Tabs-ide\\tabs-code-oss\\node_modules\\@microsoft\\dev-tunnels-ssh-tcp",
      "npm error extraneous: buildcheck@0.0.7 D:\\a\\Tabs-ide\\Tabs-ide\\tabs-code-oss\\node_modules\\buildcheck",
      "npm error A complete log of this run can be found in: C:\\npm\\cache\\_logs\\log.log",
    ].join("\n");
    expect(hasUnacceptableNpmLsErrors(validErrors)).toBe(false);

    const missingErrors = [
      "npm error code ELSPROBLEMS",
      "npm error missing: minimist@^1.2.8, required by tabs-code-oss",
      "npm error A complete log of this run can be found in: log.log",
    ].join("\n");
    expect(hasUnacceptableNpmLsErrors(missingErrors)).toBe(true);

    expect(hasUnacceptableNpmLsErrors("")).toBe(true);
    expect(hasUnacceptableNpmLsErrors("npm ERR! fatal network failure")).toBe(true);
  });
});
