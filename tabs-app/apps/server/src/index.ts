/**
 * Desktop development and server entrypoint.
 * The modern V2 CLI runs binCli.ts.
 */
import { isEntrypoint } from "./entrypoint.ts";
import { runServerEntrypoint } from "./serverEntrypoint.ts";

if (
  isEntrypoint({
    moduleUrl: import.meta.url,
    entryPath: process.argv[1],
    runtimeMain: import.meta.main,
  })
) {
  void runServerEntrypoint(process.argv.slice(2)).catch((cause) => {
    console.error(cause);
    process.exitCode = 1;
  });
}

/** Preserve the public launcher without eagerly importing every CLI command. */
export async function runCli(): Promise<void> {
  const cli = await import("./binCli.ts");
  cli.runCli();
}
