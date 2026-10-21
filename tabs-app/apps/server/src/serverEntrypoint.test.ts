import { spawnSync } from "node:child_process";

import { expect, it } from "vitest";

const entryUrl = new URL("./serverEntrypoint.ts", import.meta.url).href;
const indexUrl = new URL("./index.ts", import.meta.url).href;

it.each([
  [["--bootstrap-fd", "3"], "desktop"],
  [["--bootstrap-fd", "3", "--help"], "cli"],
  [["--bootstrap-fd", "4"], "cli"],
  [["--bootstrap-fd", "invalid"], "cli"],
  [["--help"], "cli"],
  [[], "cli"],
  [["serve"], "cli"],
  [["acp-mcp-bridge", "--socket", "test"], "acp"],
  [["acp-mcp-call", "tool", "{}"], "acp"],
] as const)("loads only the implementation needed for %j", (args, expected) => {
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { registerHooks } from "node:module";
const calls = [];
globalThis.calls = calls;
registerHooks({ resolve(specifier, context, next) {
  const implementation = specifier.endsWith("/desktopCli.ts") ? "desktop"
    : specifier.endsWith("/binCli.ts") ? "cli"
    : specifier.endsWith("/mcp/AcpMcpStdioBridge.ts") ? "acp" : null;
  if (implementation) {
    calls.push({ loaded: implementation });
    const name = implementation === "desktop" ? "runDesktopCli" : implementation === "cli" ? "runCli" : "runAcpMcpCliFastPath";
    const source = "export function " + name + "(...args) { globalThis.calls.push({ invoked: " + JSON.stringify(implementation) + ", args }); }";
    return { url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true };
  }
  return next(specifier, context);
}});
await import(${JSON.stringify(indexUrl)});
if (calls.length) throw new Error("Importing the public index eagerly loaded a command implementation");
const { runServerEntrypoint } = await import(${JSON.stringify(entryUrl)});
await runServerEntrypoint(${JSON.stringify(args)});
console.log(JSON.stringify(calls));`,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual([
    { loaded: expected },
    {
      invoked: expected,
      args: expected === "acp" ? [args[0], args.slice(1)] : [],
    },
  ]);
});
