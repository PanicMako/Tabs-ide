import type { StructuredTestingGenerationInput } from "./TextGeneration";
import type * as Schema from "effect/Schema";

export function playwrightToolConfig(
  tools?: StructuredTestingGenerationInput<Schema.Top>["playwrightTools"],
): string[] {
  if (!tools) return [];
  const settings: Record<string, unknown> = {
    command: tools.command,
    args: [...tools.args],
    cwd: tools.cwd,
    env: { ELECTRON_RUN_AS_NODE: "1", NODE_PATH: tools.nodePath },
    required: true,
    startup_timeout_sec: 60,
    tool_timeout_sec: 120,
  };
  // JSON strings/arrays are TOML-compatible; tables require explicit inline syntax.
  return Object.entries(settings).flatMap(([key, value]) => [
    "--config",
    `mcp_servers.tabs_playwright.${key}=${key === "env" ? `{ ELECTRON_RUN_AS_NODE = "1", NODE_PATH = ${JSON.stringify(tools.nodePath)} }` : JSON.stringify(value)}`,
  ]);
}
