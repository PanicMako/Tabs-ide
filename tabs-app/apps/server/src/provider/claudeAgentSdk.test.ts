import { spawnSync } from "node:child_process";

import { expect, it } from "vitest";

it("does not load the SDK when registering either generation of Claude providers", () => {
  const modules = [
    new URL("./ClaudeProvider.ts", import.meta.url).href,
    new URL("./Layers/ClaudeProvider.ts", import.meta.url).href,
    new URL("../orchestration-v2/Adapters/ClaudeAdapterV2.ts", import.meta.url).href,
  ];
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
import { registerHooks } from "node:module";
import assert from "node:assert/strict";
let loads = 0;
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@anthropic-ai/claude-agent-sdk") {
    loads++;
    return { url: "data:text/javascript,export const query = () => {};", shortCircuit: true };
  }
  return next(specifier, context);
}});
for (const module of ${JSON.stringify(modules)}) await import(module);
assert.equal(loads, 0);
const { loadClaudeAgentSdk } = await import(${JSON.stringify(new URL("./claudeAgentSdk.ts", import.meta.url).href)});
await loadClaudeAgentSdk();
assert.equal(loads, 1);
`,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
}, 15_000);
