import {
  FONT_COMBOS,
  getActiveFontCombo,
  resolveFontTypography,
  type FontPreferences,
} from "./themes";

/** Wordmarks use the display role; status captions use the interface role. */
export function resolveAnimationFonts(
  comboId: string | undefined,
  customFont: string | undefined,
  appFonts: FontPreferences,
) {
  if (comboId === "custom") {
    const font = customFont || appFonts.uiFont;
    return { headingFont: font, headingWeight: 700, uiFont: font };
  }
  const combo = FONT_COMBOS.find((item) => item.id === comboId);
  const fonts =
    !combo || comboId === "app-default"
      ? appFonts
      : {
          ...appFonts,
          uiFont: combo.uiFont,
          headingFont: combo.headingFont,
          sectionFont: undefined,
          supportingFont: undefined,
        };
  return {
    headingFont: getActiveFontCombo(fonts).id === "syne-dropped" ? fonts.uiFont : fonts.headingFont,
    headingWeight: resolveFontTypography(fonts).headingWeight,
    uiFont: fonts.uiFont,
  };
}
