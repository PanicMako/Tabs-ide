import type { DesktopInstalledExtension } from "@tabs/contracts";
import type { CustomThemeConfig } from "./lib/themes";

export interface ExtensionThemePreset {
  /** Stable across sessions: the package id plus the theme's own id. */
  readonly id: string;
  readonly name: string;
  readonly extensionName: string;
  readonly config: CustomThemeConfig;
}

/**
 * Themes from installed, enabled, unrevoked extensions as palettes for the
 * custom theme pipeline, which derives every other color from these five.
 * The user's own font choices are kept.
 */
export function extensionThemePresets(
  installed: readonly DesktopInstalledExtension[],
  fonts: CustomThemeConfig["fonts"],
): ExtensionThemePreset[] {
  const presets: ExtensionThemePreset[] = [];
  for (const extension of installed) {
    if (extension.revoked || extension.disabled || extension.compatibilityError) continue;
    for (const theme of extension.manifest.contributes.themes ?? []) {
      presets.push({
        id: `${extension.id}:${theme.id}`,
        name: theme.label,
        extensionName: extension.manifest.displayName,
        config: {
          baseVariant: theme.appearance,
          colors: {
            background: theme.colors.background.toLowerCase(),
            foreground: theme.colors.foreground.toLowerCase(),
            card: theme.colors.card.toLowerCase(),
            border: theme.colors.border.toLowerCase(),
            primary: theme.colors.primary.toLowerCase(),
          },
          fonts,
        },
      });
    }
  }
  return presets;
}

/** Whether the active custom palette is exactly this preset's colors. */
export function isActiveExtensionTheme(
  preset: ExtensionThemePreset,
  active: CustomThemeConfig,
): boolean {
  return (
    active.baseVariant === preset.config.baseVariant &&
    (["background", "foreground", "card", "border", "primary"] as const).every(
      (key) => active.colors[key]?.toLowerCase() === preset.config.colors[key],
    ) &&
    Object.keys(active.tokenOverrides ?? {}).length === 0
  );
}
