import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_THEME_CONFIGS,
  calculateContrastRatio,
  evaluateThemeTokens,
} from "@tabs/shared/themeDerivation";
import { THEME_DEFINITIONS } from "./themes";
const logo = readFileSync(new URL("../../public/icon-signature.svg", import.meta.url), "utf8");
const accent = /<rect[^>]*fill="(#[0-9A-Fa-f]{6})"/.exec(logo)![1]!;
describe.each(["tabs-dark", "tabs-light"] as const)("%s brand accent", (id) => {
  it("matches the source logo in the shell and embedded editor", () => {
    const theme = THEME_DEFINITIONS[id];
    expect(theme.colors.primary).toBe(accent);
    expect(theme.colors.ring).toBe(accent);
    expect(theme.colors.codeOss?.accent).toBe(accent);
    expect(BUILTIN_THEME_CONFIGS[id]!.colors.primary).toBe(accent);
    expect(
      calculateContrastRatio(theme.colors.primary, theme.colors.primaryForeground).ratio,
    ).toBeGreaterThanOrEqual(4.5);
    const tokens = evaluateThemeTokens(BUILTIN_THEME_CONFIGS[id]!);
    expect(
      calculateContrastRatio(tokens["button.background"]!, tokens["button.foreground"]!).ratio,
    ).toBeGreaterThanOrEqual(4.5);
  });
});
it("keeps Monotone variants neutral", () => {
  expect(THEME_DEFINITIONS["tabs-monotone"].colors.primary).toBe("#e5e5e5");
  expect(THEME_DEFINITIONS["tabs-monotone-light"].colors.primary).toBe("#3b3b3b");
});
