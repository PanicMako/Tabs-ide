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

it("configures each curated preset as a full preset with distinct heading, subheading, and interface font", () => {
  const combos = CURATED_FONT_COMBOS.filter((c) => !c.isNeutral);
  expect(combos).toHaveLength(10);
  expect(CURATED_FONT_COMBOS.some((combo) => combo.id === "editorial-dark")).toBe(false);

  const expectedPairings: Record<string, { heading: string; accent: string; ui: string }> = {
    "hebdomadal-shift": {
      heading: "'Hebdomadal', sans-serif",
      accent: "'Balbes', serif",
      ui: "'Overused Grotesk', sans-serif",
    },
    "mirano-flow": {
      heading: "'Mirano', sans-serif",
      accent: "'Gella Display', sans-serif",
      ui: "'Racama', sans-serif",
    },
    "culont-curve": {
      heading: "'Culont', sans-serif",
      accent: "'Equilla', serif",
      ui: "'Horovod', sans-serif",
    },
    "otez-contrast": {
      heading: "'Moche', sans-serif",
      accent: "'Urbanist', sans-serif",
      ui: "'ZT Floogn', sans-serif",
    },
    "aicon-grid": {
      heading: "'Aicon', sans-serif",
      accent: "'Rebel Type Dog', sans-serif",
      ui: "'Quanta Grotesk Pro', sans-serif",
    },
    "bistra-signal": {
      heading: "'KS Bistra', sans-serif",
      accent: "'Sato Sans', sans-serif",
      ui: "'Sirius', sans-serif",
    },
    "pavot-motion": {
      heading: "'Exotica', sans-serif",
      accent: "'Arck', serif",
      ui: "'Seenonim', sans-serif",
    },
    "studio-signal": {
      heading: "'Coconat', serif",
      accent: "'Sun Seed', sans-serif",
      ui: "'Gnocchi', sans-serif",
    },
    "ductile-motion": {
      heading: "'Hashira Mt', serif",
      accent: "'Halo Grotesk', sans-serif",
      ui: "'Hanken Grotesk', sans-serif",
    },
  };

  for (const [id, expected] of Object.entries(expectedPairings)) {
    const combo = combos.find((c) => c.id === id);
    expect(combo).toBeDefined();
    expect(combo!.headingFont).toBe(expected.heading);
    expect(combo!.fonts?.sectionFont).toBe(expected.accent);
    expect(combo!.uiFont).toBe(expected.ui);
    // Heading and subheading must be distinct
    expect(combo!.headingFont).not.toBe(combo!.fonts?.sectionFont);
  }
});

it("applies Full Preset Mode when selecting a curated preset", () => {
  const hebdomadal = CURATED_FONT_COMBOS.find((c) => c.id === "hebdomadal-shift")!;
  const selected = selectFontCombo(DEFAULT_FONT_PREFERENCES, hebdomadal);

  expect(selected.headingFont).toBe("'Hebdomadal', sans-serif");
  expect(selected.sectionFont).toBe("'Balbes', serif");
  expect(selected.uiFont).toBe("'Overused Grotesk', sans-serif");
  expect(selected.supportingFont).toBe("'Overused Grotesk', sans-serif");
  expect(getActiveFontCombo(selected).id).toBe("hebdomadal-shift");

  const resolved = resolveFontTypography(selected);
  expect(resolved.sectionFont).toBe("'Balbes', serif");
  expect(resolved.rowFont).toBe("'Overused Grotesk', sans-serif");
  expect(resolved.controlsFont).toBe("'Overused Grotesk', sans-serif");
  expect(resolved.supportingFont).toBe("'Overused Grotesk', sans-serif");
  expect(resolved.rowWeight).toBe(400);
  expect(resolved.supportingWeight).toBe(300);

  const upgraded = upgradeFontPreferences({
    ...DEFAULT_FONT_PREFERENCES,
    headingFont: "'Hebdomadal', sans-serif",
    sectionFont: "'Balbes', serif",
    uiFont: "'Oddval', sans-serif",
    supportingFont: "'Oddval', sans-serif",
  });
  expect(upgraded.uiFont).toBe("'Overused Grotesk', sans-serif");
  expect(upgraded.supportingFont).toBe("'Overused Grotesk', sans-serif");
});

it("applies Studio Signal with Sun Seed as subheading font and Gnocchi as interface font", () => {
  const preset = CURATED_FONT_COMBOS.find((combo) => combo.id === "studio-signal")!;
  const fonts = selectFontCombo({ ...DEFAULT_FONT_PREFERENCES, fontSizeInterface: 15 }, preset);
  expect(fonts).toMatchObject({
    uiFont: "'Gnocchi', sans-serif",
    headingFont: "'Coconat', serif",
    sectionFont: "'Sun Seed', sans-serif",
    supportingFont: "'Gnocchi', sans-serif",
    editorFont: "'Fragment Mono', monospace",
    fontSizeInterface: 15,
  });
  expect(getActiveFontCombo(fonts).id).toBe("studio-signal");

  const resolved = resolveFontTypography(fonts);
  expect(resolved.sectionFont).toBe("'Sun Seed', sans-serif");
  expect(resolved.sectionTracking).toBe("0.06em");
  expect(resolved.rowFont).toBe("'Gnocchi', sans-serif");

  const upgraded = upgradeFontPreferences({
    ...DEFAULT_FONT_PREFERENCES,
    headingFont: "'Coconat', serif",
    sectionFont: "'Sun Seed', sans-serif",
    uiFont: "'Sun Seed', sans-serif",
    supportingFont: "'Sun Seed', sans-serif",
  });
  expect(upgraded.uiFont).toBe("'Gnocchi', sans-serif");
  expect(upgraded.supportingFont).toBe("'Gnocchi', sans-serif");
});

it("configures Mirano Flow with Gella Display as accent and Racama as UI font", () => {
  const mirano = CURATED_FONT_COMBOS.find((combo) => combo.id === "mirano-flow")!;
  const selected = selectFontCombo(DEFAULT_FONT_PREFERENCES, mirano);
  expect(selected.headingFont).toBe("'Mirano', sans-serif");
  expect(selected.sectionFont).toBe("'Gella Display', sans-serif");
  expect(selected.uiFont).toBe("'Racama', sans-serif");

  const resolved = resolveFontTypography(selected);
  expect(resolved.sectionFont).toBe("'Gella Display', sans-serif");
  expect(resolved.rowFont).toBe("'Racama', sans-serif");
});

it("configures Digital Grid with Rebel Type Dog as accent and Quanta Grotesk Pro as UI font", () => {
  const aicon = CURATED_FONT_COMBOS.find((combo) => combo.id === "aicon-grid")!;
  const selected = selectFontCombo(DEFAULT_FONT_PREFERENCES, aicon);
  expect(selected.headingFont).toBe("'Aicon', sans-serif");
  expect(selected.sectionFont).toBe("'Rebel Type Dog', sans-serif");
  expect(selected.uiFont).toBe("'Quanta Grotesk Pro', sans-serif");

  const resolved = resolveFontTypography(selected);
  expect(resolved.sectionFont).toBe("'Rebel Type Dog', sans-serif");
  expect(resolved.rowFont).toBe("'Quanta Grotesk Pro', sans-serif");

  const upgraded = upgradeFontPreferences({
    ...DEFAULT_FONT_PREFERENCES,
    headingFont: "'Aicon', sans-serif",
    sectionFont: "'Rebel Type Dog', sans-serif",
    uiFont: "'OTR Type', sans-serif",
    supportingFont: "'OTR Type', sans-serif",
  });
  expect(upgraded.uiFont).toBe("'Quanta Grotesk Pro', sans-serif");
  expect(upgraded.supportingFont).toBe("'Quanta Grotesk Pro', sans-serif");
});

it("configures Moche Urbanist with Urbanist as accent and ZT Floogn as UI font", () => {
  const otez = CURATED_FONT_COMBOS.find((combo) => combo.id === "otez-contrast")!;
  const selected = selectFontCombo(DEFAULT_FONT_PREFERENCES, otez);
  expect(selected.headingFont).toBe("'Moche', sans-serif");
  expect(selected.sectionFont).toBe("'Urbanist', sans-serif");
  expect(selected.uiFont).toBe("'ZT Floogn', sans-serif");

  const resolved = resolveFontTypography(selected);
  expect(resolved.sectionFont).toBe("'Urbanist', sans-serif");
  expect(resolved.rowFont).toBe("'ZT Floogn', sans-serif");
  expect(resolved.rowWeight).toBe(300);

  const upgraded = upgradeFontPreferences({
    ...DEFAULT_FONT_PREFERENCES,
    headingFont: "'Moche', sans-serif",
    sectionFont: "'Urbanist', sans-serif",
    uiFont: "'Taruno Wide', sans-serif",
    supportingFont: "'Taruno Wide', sans-serif",
  });
  expect(upgraded.uiFont).toBe("'ZT Floogn', sans-serif");
  expect(upgraded.supportingFont).toBe("'ZT Floogn', sans-serif");
});

it("configures Culont Curve with Equilla as accent and Horovod as UI font", () => {
  const culont = CURATED_FONT_COMBOS.find((combo) => combo.id === "culont-curve")!;
  const selected = selectFontCombo(DEFAULT_FONT_PREFERENCES, culont);
  expect(selected.headingFont).toBe("'Culont', sans-serif");
  expect(selected.sectionFont).toBe("'Equilla', serif");
  expect(selected.uiFont).toBe("'Horovod', sans-serif");

  const resolved = resolveFontTypography(selected);
  expect(resolved.sectionFont).toBe("'Equilla', serif");
  expect(resolved.rowFont).toBe("'Horovod', sans-serif");

  const upgraded = upgradeFontPreferences({
    ...DEFAULT_FONT_PREFERENCES,
    headingFont: "'Culont', sans-serif",
    sectionFont: "'Equilla', serif",
    uiFont: "'Novoposelensky', sans-serif",
    supportingFont: "'Novoposelensky', sans-serif",
  });
  expect(upgraded.uiFont).toBe("'Horovod', sans-serif");
  expect(upgraded.supportingFont).toBe("'Horovod', sans-serif");
});

it("configures Exotica Motion with Arck as accent and Seenonim as UI font", () => {
  const pavot = CURATED_FONT_COMBOS.find((combo) => combo.id === "pavot-motion")!;
  const selected = selectFontCombo(DEFAULT_FONT_PREFERENCES, pavot);
  expect(selected.headingFont).toBe("'Exotica', sans-serif");
  expect(selected.sectionFont).toBe("'Arck', serif");
  expect(selected.uiFont).toBe("'Seenonim', sans-serif");

  const resolved = resolveFontTypography(selected);
  expect(resolved.sectionFont).toBe("'Arck', serif");
  expect(resolved.rowFont).toBe("'Seenonim', sans-serif");

  const upgraded = upgradeFontPreferences({
    ...DEFAULT_FONT_PREFERENCES,
    headingFont: "'Exotica', sans-serif",
    sectionFont: "'Arck', serif",
    uiFont: "'Gerbil', sans-serif",
    supportingFont: "'Gerbil', sans-serif",
  });
  expect(upgraded.uiFont).toBe("'Seenonim', sans-serif");
  expect(upgraded.supportingFont).toBe("'Seenonim', sans-serif");
});

it("configures Hashira Modular with Halo Grotesk as accent and Hanken Grotesk as UI font", () => {
  const ductile = CURATED_FONT_COMBOS.find((combo) => combo.id === "ductile-motion")!;
  const selected = selectFontCombo(DEFAULT_FONT_PREFERENCES, ductile);
  expect(selected.headingFont).toBe("'Hashira Mt', serif");
  expect(selected.sectionFont).toBe("'Halo Grotesk', sans-serif");
  expect(selected.uiFont).toBe("'Hanken Grotesk', sans-serif");

  const resolved = resolveFontTypography(selected);
  expect(resolved.sectionFont).toBe("'Halo Grotesk', sans-serif");
  expect(resolved.rowFont).toBe("'Hanken Grotesk', sans-serif");

  const upgraded = upgradeFontPreferences({
    ...DEFAULT_FONT_PREFERENCES,
    headingFont: "'Hashira Mt', serif",
    sectionFont: "'Halo Grotesk', sans-serif",
    uiFont: "'Overused Grotesk', sans-serif",
    supportingFont: "'Overused Grotesk', sans-serif",
  });
  expect(upgraded.uiFont).toBe("'Hanken Grotesk', sans-serif");
  expect(upgraded.supportingFont).toBe("'Hanken Grotesk', sans-serif");
});
