import { describe, expect, it } from "vitest";
import type { DesktopInstalledExtension } from "@tabs/contracts";
import { extensionThemePresets, isActiveExtensionTheme } from "./extensionThemes";

const fonts = { uiFont: "Inter, sans-serif", editorFont: "Geist Mono, monospace" };

function installed(overrides: Partial<DesktopInstalledExtension> = {}): DesktopInstalledExtension {
  return {
    id: "acme.ember",
    source: "local",
    revoked: false,
    disabled: false,
    manifest: {
      manifestVersion: 1,
      publisher: "acme",
      name: "ember",
      version: "1.0.0",
      displayName: "Ember Themes",
      description: "Warm palettes",
      engines: { tabs: ">=2.0.0", api: "^1.9.0" },
      contributes: {
        tools: [],
        themes: [
          {
            id: "ember",
            label: "Ember",
            appearance: "dark",
            colors: {
              background: "#140D0B",
              foreground: "#F6E7DF",
              card: "#1F1512",
              border: "#3A2820",
              primary: "#FF6A3D",
            },
          },
        ],
      },
    },
    ...overrides,
  } as unknown as DesktopInstalledExtension;
}

describe("extension themes", () => {
  it("becomes a custom palette that keeps the user's fonts", () => {
    const [preset] = extensionThemePresets([installed()], fonts);
    expect(preset).toMatchObject({
      id: "acme.ember:ember",
      name: "Ember",
      extensionName: "Ember Themes",
    });
    expect(preset!.config).toEqual({
      baseVariant: "dark",
      colors: {
        background: "#140d0b",
        foreground: "#f6e7df",
        card: "#1f1512",
        border: "#3a2820",
        primary: "#ff6a3d",
      },
      fonts,
    });
    expect(isActiveExtensionTheme(preset!, preset!.config)).toBe(true);
    expect(
      isActiveExtensionTheme(preset!, {
        ...preset!.config,
        tokenOverrides: { "--ring": "#000000" },
      }),
    ).toBe(false);
  });

  it("drops themes from paused, revoked or incompatible packages", () => {
    expect(extensionThemePresets([installed({ disabled: true })], fonts)).toEqual([]);
    expect(extensionThemePresets([installed({ revoked: true })], fonts)).toEqual([]);
    expect(
      extensionThemePresets([installed({ compatibilityError: "Needs a newer Tabs." })], fonts),
    ).toEqual([]);
  });
});
