import type { DesktopInstalledExtension, ProjectToolDefinition } from "@tabs/contracts";
import { isExtensionEnabledForProject } from "@tabs/shared/extensions";

/** Keep the saved order and visibility, but take identity and labels from verified packages. */
export function mergeExtensionToolbarTools(
  savedTools: readonly ProjectToolDefinition[],
  installedExtensions: readonly DesktopInstalledExtension[],
  projectId: string,
): ProjectToolDefinition[] {
  const available = new Map<string, ProjectToolDefinition>();
  for (const extension of installedExtensions) {
    if (
      extension.revoked ||
      extension.disabled ||
      !isExtensionEnabledForProject(extension.assignment, projectId)
    )
      continue;
    for (const tool of extension.manifest.contributes.tools) {
      const definition: ProjectToolDefinition = {
        id: `ext:${extension.id}:${tool.id}`,
        kind: "extension",
        label: tool.label,
        visible: true,
        extensionId: extension.id,
        extensionToolId: tool.id,
      };
      available.set(definition.id, definition);
    }
  }

  const merged: ProjectToolDefinition[] = [];
  for (const saved of savedTools) {
    if (saved.kind !== "extension") {
      merged.push(saved);
      continue;
    }
    const verified = available.get(saved.id);
    if (
      !verified ||
      saved.extensionId !== verified.extensionId ||
      saved.extensionToolId !== verified.extensionToolId
    )
      continue;
    available.delete(saved.id);
    merged.push({ ...verified, visible: saved.visible });
  }
  return [...merged, ...available.values()];
}

/** Keep preferences for temporarily disabled tools when another toolbar item is edited. */
export function preserveUnavailableExtensionTools(
  original: readonly ProjectToolDefinition[],
  available: readonly ProjectToolDefinition[],
): ProjectToolDefinition[] {
  const availableIds = new Set(available.map((tool) => tool.id));
  return [
    ...available,
    ...original.filter((tool) => tool.kind === "extension" && !availableIds.has(tool.id)),
  ];
}
