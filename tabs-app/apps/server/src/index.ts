/**
 * Entry point for Tabs server / CLI.
 */
import { isEntrypoint } from "./entrypoint.ts";

if (
  isEntrypoint({
    moduleUrl: import.meta.url,
    entryPath: process.argv[1],
    runtimeMain: import.meta.main,
  })
) {
  void (async () => {
    const command = process.argv[2];
    if (command === "acp-mcp-bridge" || command === "acp-mcp-call") {
      const { runAcpMcpCliFastPath } = await import("./mcp/AcpMcpStdioBridge.ts");
      await runAcpMcpCliFastPath(command, process.argv.slice(3));
    } else {
      const { runCli } = await import("./binCli.ts");
      runCli();
    }
  })();
}

export { runCli } from "./binCli.ts";
