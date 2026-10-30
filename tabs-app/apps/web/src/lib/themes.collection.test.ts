import { describe, expect, it } from "vitest";
import { BUILTIN_THEME_CONFIGS, calculateContrastRatio } from "@tabs/shared/themeDerivation";
import { THEME_DEFINITIONS } from "./themes";

describe("built-in theme collection", () => {
  it.each(Object.entries(BUILTIN_THEME_CONFIGS))(
    "%s keeps the picker, shell and native editor on the same palette",
    (id, embedded) => {
      const theme = THEME_DEFINITIONS[id as keyof typeof THEME_DEFINITIONS];
      expect(theme.baseVariant).toBe(embedded.baseVariant);
      for (const key of ["background", "card", "foreground", "border", "primary"] as const) {
        expect(theme.colors[key]).toBe(embedded.colors[key]);
      }
      expect(theme.colors.codeOss.accent).toBe(theme.colors.primary);
    },
  );
  it.each([
    "tabs-dark",
    "true-black",
    "tabs-light",
    "abyss",
    "dracula",
    "deep-blue",
    "solarized-light",
  ] as const)("%s keeps text and filled controls readable", (id) => {
    const { colors } = THEME_DEFINITIONS[id];
    for (const surface of [colors.background, colors.card]) {
      expect(calculateContrastRatio(colors.foreground, surface).ratio).toBeGreaterThanOrEqual(7);
      expect(calculateContrastRatio(colors.mutedForeground, surface).ratio).toBeGreaterThanOrEqual(
        4.5,
      );
    }
    expect(
      calculateContrastRatio(colors.primary, colors.primaryForeground).ratio,
    ).toBeGreaterThanOrEqual(4.5);
  });
});
