/** Dispatch before loading command implementations or their dependency graphs. */
export async function runServerEntrypoint(args: readonly string[]): Promise<void> {
  const command = args[0];
  if (command === "acp-mcp-bridge" || command === "acp-mcp-call") {
    const { runAcpMcpCliFastPath } = await import("./mcp/AcpMcpStdioBridge.ts");
    await runAcpMcpCliFastPath(command, args.slice(1));
  } else if (args.length === 2 && command === "--bootstrap-fd" && args[1] === "3") {
    // This is the desktop parent's exact invocation. All other CLI forms retain
    // the full command parser, including help, validation and extra flags.
    const { runDesktopCli } = await import("./desktopCli.ts");
    runDesktopCli();
  } else {
    const { runCli } = await import("./binCli.ts");
    runCli();
  }
}
