/** Dispatch before loading command implementations or their dependency graphs. */
export async function runServerEntrypoint(args: readonly string[]): Promise<void> {
  const command = args[0];
  if (command === "__document-text") {
    // Isolated parser process: DocumentText spawns this so a hostile file cannot reach the server.
    const { extractDocumentText } = await import("./provider/documentTextWorker.ts");
    try {
      process.stdout.write(await extractDocumentText(args[1]!, args[2]!));
    } catch (error) {
      if (error instanceof Error && "code" in error && /^E[A-Z0-9]+$/.test(String(error.code))) {
        throw error;
      }
      // Exit 2 identifies document rejections; OS and process failures remain retryable.
      process.exitCode = 2;
    }
  } else if (command === "__managed-chatgpt-token") {
    const { runManagedChatGptTokenCli } = await import("./cli/managedChatGptToken.ts");
    await runManagedChatGptTokenCli(args.slice(1));
  } else if (command === "acp-mcp-bridge" || command === "acp-mcp-call") {
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
