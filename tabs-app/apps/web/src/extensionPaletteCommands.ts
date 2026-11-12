import type { DesktopInstalledExtension } from "@tabs/contracts";
import { extensionToolbarToolId } from "./extensionToolbarTools";

/** What choosing the entry does: open one of the extension's tools, or run a command. */
export type ExtensionPaletteTarget =
  | { readonly kind: "tool"; readonly toolbarToolId: string }
  | { readonly kind: "command"; readonly extensionId: string; readonly paletteCommandId: string };

export interface ExtensionPaletteCommand {
  readonly value: string;
  readonly title: string;
  readonly description: string;
  readonly searchTerms: readonly string[];
  readonly target: ExtensionPaletteTarget;
}

/** Command Palette entries from installed, enabled, unrevoked extensions. */
export function extensionPaletteCommands(
  installed: readonly DesktopInstalledExtension[],
): ExtensionPaletteCommand[] {
  const commands: ExtensionPaletteCommand[] = [];
  for (const extension of installed) {
    if (extension.revoked || extension.disabled || extension.compatibilityError) continue;
    const { manifest } = extension;
    for (const entry of manifest.contributes.paletteCommands ?? []) {
      const searchTerms = [
        ...(entry.keywords ?? []),
        manifest.displayName.toLowerCase(),
        "extension",
      ];
      if (entry.tool !== undefined) {
        const tool = manifest.contributes.tools.find((candidate) => candidate.id === entry.tool);
        if (!tool) continue;
        const toolbarToolId = extensionToolbarToolId(extension, tool.id);
        commands.push({
          value: `extension:${toolbarToolId}:${entry.id}`,
          title: entry.title,
          description: entry.description ?? `${manifest.displayName} · ${tool.label}`,
          searchTerms: [...searchTerms.slice(0, -1), tool.label.toLowerCase(), "extension"],
          target: { kind: "tool", toolbarToolId },
        });
      } else if (entry.command !== undefined) {
        const command = manifest.contributes.commands?.find(
          (candidate) => candidate.id === entry.command,
        );
        if (!command) continue;
        commands.push({
          value: `extension:${encodeURIComponent(extension.registryOrigin ?? extension.source)}:${extension.id}:command:${entry.id}`,
          title: entry.title,
          description: entry.description ?? `${manifest.displayName} · ${command.label}`,
          searchTerms: [...searchTerms.slice(0, -1), command.label.toLowerCase(), "extension"],
          target: { kind: "command", extensionId: extension.id, paletteCommandId: entry.id },
        });
      }
    }
  }
  return commands;
}

/** A command's JSON result as one short line for a notification. */
export function summarizePaletteResult(result: unknown): string {
  if (result === null || result === undefined) return "Done.";
  const text = typeof result === "string" ? result : JSON.stringify(result);
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return "Done.";
  return line.length > 280 ? `${line.slice(0, 277)}…` : line;
}
