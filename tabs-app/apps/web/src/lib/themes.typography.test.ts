import { expect, it } from "vitest";
import {
  FONT_COMBOS,
  CURATED_FONT_COMBOS,
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
  const combos = CURATED_FONT_COMBOS.filter((combo) => !combo.isNeutral);
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

it("changes only heading roles for the new collection and preserves personal settings", () => {
  const personal = {
    ...DEFAULT_FONT_PREFERENCES,
    uiFont: "'Syne', sans-serif",
    supportingFont: "'Newsreader', serif",
    editorFont: "Menlo",
    fontSizeInterface: 15,
  };
  for (const combo of CURATED_FONT_COMBOS.filter((item) => item.headingOnly)) {
    const selected = selectFontCombo(personal, combo);
    expect(selected.uiFont).toBe(personal.uiFont);
    expect(selected.supportingFont).toBe(personal.supportingFont);
    expect(selected.editorFont).toBe(personal.editorFont);
    expect(selected.fontSizeInterface).toBe(personal.fontSizeInterface);
    expect(selected.headingFont).toBe(combo.headingFont);
    expect(getActiveFontCombo(selected).id).toBe(combo.id);
    expect(resolveFontTypography(selected).rowFont).toBe(personal.uiFont);
    expect(resolveFontTypography(selected).controlsFont).toBe(personal.uiFont);
    expect(resolveFontTypography(selected).supportingFont).toBe(personal.supportingFont);
  }
  expect(CURATED_FONT_COMBOS.some((combo) => combo.id === "editorial-dark")).toBe(false);
  expect(CURATED_FONT_COMBOS.find((combo) => combo.id === "syne-dropped")?.name).toBe(
    "Abstract Forms",
  );
});

it("applies Studio Signal as a built-in combination with the original personal font roles", () => {
  const preset = CURATED_FONT_COMBOS.find((combo) => combo.id === "studio-signal")!;
  const fonts = selectFontCombo({ ...DEFAULT_FONT_PREFERENCES, fontSizeInterface: 15 }, preset);
  expect(fonts).toMatchObject({
    uiFont: "'Syne', sans-serif",
    headingFont: "'Coconat', serif",
    sectionFont: "'Sun Seed', sans-serif",
    supportingFont: "'Syne', sans-serif",
    editorFont: "Menlo, Monaco, 'Courier New', monospace",
    fontSizeInterface: 15,
  });
  expect(getActiveFontCombo(fonts).id).toBe("studio-signal");
  expect(getActiveFontCombo({ ...fonts, editorFont: "Consolas" }).id).toBe("studio-signal");
  expect(resolveFontTypography(fonts)).toMatchObject({
    headingWeight: 700,
    headingTracking: "-.04em",
    sectionFont: "'Sun Seed', sans-serif",
    sectionStyle: "normal",
    rowFont: "'Syne', sans-serif",
    controlsFont: "'Syne', sans-serif",
    supportingFont: "'Syne', sans-serif",
  });
});
