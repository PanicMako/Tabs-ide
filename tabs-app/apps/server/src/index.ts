/**
 * Desktop development and server entrypoint.
 * The modern V2 CLI runs binCli.ts.
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
  })().catch((cause) => {
    console.error(cause);
    process.exitCode = 1;
  });
}

export { runCli } from "./binCli.ts";
