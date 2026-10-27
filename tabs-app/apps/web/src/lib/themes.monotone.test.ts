import { describe, expect, it, vi } from "vitest";
import {
  BUILTIN_THEME_CONFIGS,
  calculateContrastRatio,
  evaluateThemeTokens,
} from "@tabs/shared/themeDerivation";
import { resolveActiveThemeId } from "../hooks/useTheme";
import { THEME_DEFINITIONS } from "./themes";

describe("Monotone Light", () => {
  it("keeps the shell and embedded theme on the same neutral base palette", () => {
    const shell = THEME_DEFINITIONS["tabs-monotone-light"];
    const embedded = BUILTIN_THEME_CONFIGS["tabs-monotone-light"]!;
    expect(shell.baseVariant).toBe("light");
    expect(embedded.baseVariant).toBe("light");
    for (const key of ["background", "foreground", "card", "border", "primary"] as const) {
      expect(shell.colors[key]).toBe(embedded.colors[key]);
      const hex = shell.colors[key].slice(1);
      expect(hex.slice(0, 2)).toBe(hex.slice(2, 4));
      expect(hex.slice(2, 4)).toBe(hex.slice(4, 6));
    }
    expect(shell.colors.card).not.toBe(shell.colors.background);
    expect(shell.colors.primary).not.toBe("#ffffff");
    expect(
      calculateContrastRatio(shell.colors.foreground, shell.colors.card).ratio,
    ).toBeGreaterThanOrEqual(4.5);
    const tokens = evaluateThemeTokens(embedded);
    expect(
      calculateContrastRatio(tokens["button.foreground"]!, tokens["button.background"]!).ratio,
    ).toBeGreaterThanOrEqual(4.5);
    expect(tokens["editor.background"]).toBe(shell.colors.card);
  });
});

it("resolves system appearance to the matching Monotone variant", () => {
  try {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    expect(resolveActiveThemeId("system")).toBe("tabs-monotone");
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(resolveActiveThemeId("system")).toBe("tabs-monotone-light");
    expect(resolveActiveThemeId("tabs-light")).toBe("tabs-light");
  } finally {
    vi.unstubAllGlobals();
  }
});
