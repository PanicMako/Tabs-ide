import { spawnSync } from "node:child_process";

import { expect, it } from "vitest";

it("keeps the compiler unloaded until repository parsing is requested", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(${JSON.stringify(import.meta.url)});
const compilerPath = require.resolve("typescript");
await import(${JSON.stringify(new URL("./testInventory.ts", import.meta.url).href)});
await import(${JSON.stringify(new URL("./locatorImporter.ts", import.meta.url).href)});
await import(${JSON.stringify(new URL("./locatorLibrary.ts", import.meta.url).href)});
assert.equal(require.cache[compilerPath], undefined);
const { loadTypeScript } = await import(${JSON.stringify(new URL("./typeScript.ts", import.meta.url).href)});
const compiler = loadTypeScript();
assert.equal(loadTypeScript(), compiler);
assert.ok(require.cache[compilerPath]);
const source = compiler.createSourceFile("test.ts", "const value = 1", compiler.ScriptTarget.Latest);
assert.equal(source.statements.length, 1);`,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
});
