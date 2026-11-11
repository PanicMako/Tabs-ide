import type { DesktopInstalledExtension } from "@tabs/contracts";
import { extensionToolbarToolId } from "../../extensionToolbarTools";
import type { ExtensionLauncherAction } from "./actions";

/** Launcher ids are tied to the package's source, like its toolbar tools. */
export function extensionQuickActionId(toolbarToolId: string, actionId: string): string {
  return `${toolbarToolId}:qa:${actionId}`;
}

/**
 * Launcher entries from installed extensions. Only verified, enabled packages
 * contribute; whether the tool is on in the current project is checked when
 * the action runs, so the launcher keeps a stable layout across projects.
 */
export function extensionLauncherActions(
  installed: readonly DesktopInstalledExtension[],
): ExtensionLauncherAction[] {
  const actions: ExtensionLauncherAction[] = [];
  for (const extension of installed) {
    if (extension.revoked || extension.disabled) continue;
    const { manifest } = extension;
    for (const quick of manifest.contributes.quickActions ?? []) {
      const tool = manifest.contributes.tools.find((candidate) => candidate.id === quick.tool);
      if (!tool) continue;
      const toolbarToolId = extensionToolbarToolId(extension, tool.id);
      actions.push({
        id: extensionQuickActionId(toolbarToolId, quick.id),
        label: quick.label,
        detail: quick.detail ?? `Open ${tool.label} · ${manifest.displayName}`,
        group: "Extensions",
        icon: quick.icon ?? "zap",
        custom: { actionId: "extension-tool", query: toolbarToolId },
        extension: { id: extension.id, displayName: manifest.displayName, toolLabel: tool.label },
      });
    }
  }
  return actions;
}
