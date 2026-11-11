import type { DesktopInstalledExtension } from "@tabs/contracts";
import { extensionToolbarToolId } from "./extensionToolbarTools";

export interface ExtensionPaletteCommand {
  readonly value: string;
  readonly title: string;
  readonly description: string;
  readonly searchTerms: readonly string[];
  readonly toolbarToolId: string;
}

/** Command Palette entries from installed, enabled, unrevoked extensions. */
export function extensionPaletteCommands(
  installed: readonly DesktopInstalledExtension[],
): ExtensionPaletteCommand[] {
  const commands: ExtensionPaletteCommand[] = [];
  for (const extension of installed) {
    if (extension.revoked || extension.disabled || extension.compatibilityError) continue;
    const { manifest } = extension;
    for (const command of manifest.contributes.paletteCommands ?? []) {
      const tool = manifest.contributes.tools.find((candidate) => candidate.id === command.tool);
      if (!tool) continue;
      const toolbarToolId = extensionToolbarToolId(extension, tool.id);
      commands.push({
        value: `extension:${toolbarToolId}:${command.id}`,
        title: command.title,
        description: command.description ?? `${manifest.displayName} · ${tool.label}`,
        searchTerms: [
          ...(command.keywords ?? []),
          manifest.displayName.toLowerCase(),
          tool.label.toLowerCase(),
          "extension",
        ],
        toolbarToolId,
      });
    }
  }
  return commands;
}
