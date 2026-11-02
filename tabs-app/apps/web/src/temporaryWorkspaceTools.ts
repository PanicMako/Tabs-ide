import type { ProjectToolDefinition, ProjectWorkspaceSettings } from "@tabs/contracts/settings";

export function isTemporaryWorkspaceTool(
  tool: Pick<ProjectToolDefinition, "id" | "kind" | "temporary">,
): boolean {
  return tool.temporary ?? (tool.kind === "custom_embed" && tool.id.startsWith("scratch-"));
}
export function canCloseWorkspaceTool(tool: Pick<ProjectToolDefinition, "kind">): boolean {
  return tool.kind === "custom_embed" || tool.kind === "custom_process";
}
export function keepWorkspaceTool(
  settings: ProjectWorkspaceSettings,
  id: string,
  label: string,
): ProjectWorkspaceSettings {
  const tool = settings.tools.find((entry) => entry.id === id);
  if (!tool || !isTemporaryWorkspaceTool(tool)) return settings;
  const name = label.trim() || tool.label;
  return {
    ...settings,
    tools: settings.tools.map((entry) =>
      entry.id === id ? { ...entry, temporary: false, label: name } : entry,
    ),
    customEmbeds: settings.customEmbeds.map((entry) =>
      entry.id === tool.customEmbedId ? { ...entry, label: name } : entry,
    ),
    terminalProcesses: settings.terminalProcesses.map((entry) =>
      entry.id === tool.terminalProcessId ? { ...entry, label: name } : entry,
    ),
  };
}
/** Closing a temporary tool discards its configuration; a kept tool is only hidden. */
export function closeWorkspaceTool(
  settings: ProjectWorkspaceSettings,
  id: string,
): ProjectWorkspaceSettings {
  const tool = settings.tools.find((entry) => entry.id === id);
  if (!tool || !canCloseWorkspaceTool(tool)) return settings;
  if (!isTemporaryWorkspaceTool(tool))
    return {
      ...settings,
      tools: settings.tools.map((entry) =>
        entry.id === id ? { ...entry, visible: false } : entry,
      ),
    };
  const tools = settings.tools.filter((entry) => entry.id !== id);
  return {
    ...settings,
    tools,
    customEmbeds: settings.customEmbeds.filter(
      (entry) =>
        entry.id !== tool.customEmbedId || tools.some((other) => other.customEmbedId === entry.id),
    ),
    terminalProcesses: settings.terminalProcesses.filter(
      (entry) =>
        entry.id !== tool.terminalProcessId ||
        tools.some((other) => other.terminalProcessId === entry.id),
    ),
  };
}
