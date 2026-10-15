import { expect, it } from "vitest";
import { resolveAnimationFonts } from "./animationTypography";
import { DEFAULT_FONT_PREFERENCES } from "./themes";

it("distinguishes display faces even when animation pairings share an interface font", () => {
  const dot = resolveAnimationFonts("dot-matrix", undefined, DEFAULT_FONT_PREFERENCES);
  const serif = resolveAnimationFonts("editorial-dark", undefined, DEFAULT_FONT_PREFERENCES);
  expect(dot.uiFont).toBe(serif.uiFont);
  expect(dot.headingFont).toContain("Doto");
  expect(dot.headingWeight).toBe(900);
  expect(serif.headingFont).toContain("Instrument Serif");
  expect(serif.headingWeight).toBe(400);
});
it("inherits live app roles and keeps dedicated overrides independent", () => {
  const custom = {
    ...DEFAULT_FONT_PREFERENCES,
    headingFont: "'Coconat', serif",
    sectionFont: "'Ronzino', sans-serif",
  };
  expect(resolveAnimationFonts("app-default", undefined, custom)).toMatchObject({
    headingFont: custom.headingFont,
    headingWeight: 700,
    uiFont: custom.uiFont,
  });
  expect(resolveAnimationFonts("custom", "'Messapia', monospace", custom).headingFont).toContain(
    "Messapia",
  );
});
