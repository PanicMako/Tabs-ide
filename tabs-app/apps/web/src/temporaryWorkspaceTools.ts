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

/** Prefix shared by every Scratch Browser tool and its custom embed. */
export const SCRATCH_BROWSER_ID_PREFIX = "scratch-";

/**
 * Add a temporary Scratch Browser tab. Quick Actions and in-app link handling
 * both create Scratch Browsers through here so they stay identical: isolated
 * partition, resumes its last page, discarded on close unless kept.
 */
export function addScratchBrowserTool(
  settings: ProjectWorkspaceSettings,
  input: { id: string; label: string; url: string },
): ProjectWorkspaceSettings {
  return {
    ...settings,
    customEmbeds: [
      ...settings.customEmbeds,
      {
        id: input.id,
        label: input.label,
        url: input.url,
        resumeLastVisitedPage: true,
        partitionMode: "isolated",
      },
    ],
    tools: [
      ...settings.tools,
      {
        id: input.id,
        kind: "custom_embed",
        temporary: true,
        label: input.label,
        visible: true,
        customEmbedId: input.id,
      },
    ],
  };
}

/**
 * A still-open temporary Scratch Browser that was opened for exactly this URL,
 * so clicking the same link twice focuses the existing tab instead of stacking
 * duplicates.
 */
export function findScratchBrowserForUrl(
  settings: ProjectWorkspaceSettings,
  url: string,
): string | null {
  const tool = settings.tools.find((entry) => {
    if (entry.kind !== "custom_embed" || !entry.visible || !isTemporaryWorkspaceTool(entry))
      return false;
    const embed = settings.customEmbeds.find((item) => item.id === entry.customEmbedId);
    return (
      embed?.url === url && (embed.lastVisitedUrl === undefined || embed.lastVisitedUrl === url)
    );
  });
  return tool?.id ?? null;
}

/** Short tab label for a link: its host without `www.`. */
export function scratchBrowserLabelForUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host || "Scratch browser";
  } catch {
    return "Scratch browser";
  }
}
