import type { ProjectToolDefinition, ProjectWorkspaceSettings } from "@tabs/contracts";

/** The binding of a toolbar entry, excluding display and live navigation state. */
export function projectToolBinding(
  settings: ProjectWorkspaceSettings,
  tool: ProjectToolDefinition,
): string {
  const embed = settings.customEmbeds.find((entry) => entry.id === tool.customEmbedId);
  const process = settings.terminalProcesses.find((entry) => entry.id === tool.terminalProcessId);
  return JSON.stringify([
    tool.kind,
    tool.visible,
    tool.customEmbedId ?? null,
    tool.terminalProcessId ?? null,
    tool.serverProcessId ?? null,
    tool.extensionId ?? null,
    tool.extensionToolId ?? null,
    embed ? [embed.url, embed.partitionMode, embed.partitionProfile] : null,
    process
      ? [process.cwd, process.commands, process.command, process.interactiveShell, process.env]
      : null,
    tool.kind === "browser"
      ? [
          settings.browser.defaultUrl,
          settings.browser.partitionMode,
          settings.browser.partitionProfile,
        ]
      : null,
  ]);
}
