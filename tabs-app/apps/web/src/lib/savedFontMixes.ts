import { prepareCustomFontPreferences, type FontPreferences } from "./themes";

export const SAVED_FONT_MIXES_KEY = "tabs:saved-font-mixes:v1";
const ROLE_KEYS = ["uiFont", "headingFont", "sectionFont", "supportingFont", "editorFont"] as const;
export type FontMixRoles = Pick<FontPreferences, (typeof ROLE_KEYS)[number]>;
export interface SavedFontMix {
  id: string;
  name: string;
  fonts: FontMixRoles;
}

export function captureFontMix(fonts: FontPreferences): FontMixRoles {
  const custom = prepareCustomFontPreferences(fonts);
  return Object.fromEntries(ROLE_KEYS.map((key) => [key, custom[key]])) as FontMixRoles;
}

export function matchesFontMix(fonts: FontPreferences, mix: SavedFontMix): boolean {
  const current = captureFontMix(fonts);
  return ROLE_KEYS.every((key) => current[key] === mix.fonts[key]);
}

export function readSavedFontMixes(): SavedFontMix[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SAVED_FONT_MIXES_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (mix): mix is SavedFontMix =>
        mix !== null &&
        typeof mix === "object" &&
        typeof mix.id === "string" &&
        typeof mix.name === "string" &&
        mix.name.trim().length > 0 &&
        mix.fonts !== null &&
        typeof mix.fonts === "object" &&
        ROLE_KEYS.every((key) => typeof mix.fonts[key] === "string" && mix.fonts[key].length > 0),
    );
  } catch {
    return [];
  }
}
