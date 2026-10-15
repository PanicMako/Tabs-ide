import { expect, it } from "vitest";
import {
  FONT_COMBOS,
  DEFAULT_FONT_PREFERENCES,
  upgradeFontPreferences,
  getFontComboPageHeading,
  getActiveFontCombo,
  prepareCustomFontPreferences,
  resolveFontTypography,
  selectFontCombo,
} from "./themes";

it("keeps Syne Dropped unchanged and upgrades only known preset pairs", () => {
  expect(upgradeFontPreferences(DEFAULT_FONT_PREFERENCES)).toBe(DEFAULT_FONT_PREFERENCES);
  const custom = {
    ...DEFAULT_FONT_PREFERENCES,
    uiFont: "'Chivo', sans-serif",
    headingFont: "'Syne', sans-serif",
  };
  expect(upgradeFontPreferences(custom)).toBe(custom);
  const previous = {
    ...DEFAULT_FONT_PREFERENCES,
    uiFont: "'Chivo', sans-serif",
    headingFont: "'Cormorant Garamond', serif",
    fontSizeInterface: 15,
  };
  expect(upgradeFontPreferences(previous)).toEqual({
    ...previous,
    uiFont: "'Geist', sans-serif",
    headingFont: "'Instrument Serif', serif",
  });
});
it("uses the revised heading face for page titles while preserving Syne's title", () => {
  const combos = FONT_COMBOS.filter((combo) => !combo.isNeutral);
  expect(combos).toHaveLength(10);
  for (const combo of combos) {
    expect(getFontComboPageHeading(combo).fontFamily).toBe(
      combo.id === "syne-dropped" ? "var(--font-sans)" : "var(--font-display)",
    );
  }
});

it("mixes roles independently and clears them when selecting a preset", () => {
  const custom = {
    ...prepareCustomFontPreferences(DEFAULT_FONT_PREFERENCES),
    headingFont: "'Coconat', serif",
    sectionFont: "'Parkinsans', sans-serif",
    supportingFont: "'Absans', sans-serif",
  };
  const resolved = resolveFontTypography(custom);
  expect(resolved.rowFont).toBe(DEFAULT_FONT_PREFERENCES.uiFont);
  expect(resolved.headingWeight).toBe(700);
  expect(resolved.sectionFont).toBe(custom.sectionFont);
  expect(resolved.supportingFont).toBe(custom.supportingFont);
  expect(getFontComboPageHeading(getActiveFontCombo(custom), custom).fontFamily).toBe(
    "var(--font-display)",
  );
  expect(upgradeFontPreferences(custom)).toBe(custom);
  const preset = FONT_COMBOS.find((combo) => combo.id === "sculpted-contrast")!;
  const selected = selectFontCombo(custom, preset);
  expect(selected.sectionFont).toBeUndefined();
  expect(selected.supportingFont).toBeUndefined();
  expect(resolveFontTypography(selected).sectionFont).toBe(preset.typography!.sectionFont);
  expect(selected.editorFont).toBe(custom.editorFont);
});

it("preserves Syne Dropped's section and supporting typography", () => {
  const resolved = resolveFontTypography(DEFAULT_FONT_PREFERENCES);
  expect(resolved.sectionFont).toBe(DEFAULT_FONT_PREFERENCES.headingFont);
  expect(resolved.sectionStyle).toBe("italic");
  expect(resolved.supportingFont).toBe(DEFAULT_FONT_PREFERENCES.uiFont);
});
