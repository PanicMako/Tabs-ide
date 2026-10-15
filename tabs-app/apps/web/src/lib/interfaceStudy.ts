import type { CustomThemeConfig, FontPreferences } from "./themes";
import type { CSSProperties } from "react";

/** Stable accents survive tab reordering and are only painted by the study CSS. */
export function interfaceStudyAccent(identity: string): CSSProperties {
  const hues = [215, 345, 145, 38, 270, 185];
  let hash = 0;
  for (const letter of identity) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
  return { "--study-tint": `hsl(${hues[hash % hues.length]} 65% 65%)` } as CSSProperties;
}

/** A reversible experiment; saved themes and font choices stay untouched. */
export function interfaceStudyTheme(
  appearance: "dark" | "light",
  fonts: FontPreferences,
): CustomThemeConfig {
  const dark = appearance === "dark";
  const ink = dark ? "#eeede8" : "#242424";
  const paper = dark ? "#202020" : "#f5f4f0";
  const surface = dark ? "#252525" : "#f0efeb";
  const selected = dark ? "#363636" : "#e2e1db";
  return {
    baseVariant: appearance,
    colors: {
      background: paper,
      foreground: ink,
      card: surface,
      border: dark ? "#383838" : "#dcdad3",
      primary: dark ? "#454642" : "#dfddd5",
    },
    fonts,
    tokenOverrides: {
      "app.primaryBackground": dark ? "#454642" : "#dfddd5",
      "app.primaryForeground": ink,
      "app.accentBackground": selected,
      "app.accentForeground": ink,
      "app.secondaryBackground": selected,
      "app.secondaryForeground": ink,
      "app.mutedBackground": dark ? "#2b2b2b" : "#eae9e4",
      "app.mutedForeground": dark ? "#aaa9a3" : "#686762",
      "app.cardBackground": surface,
      "app.cardForeground": ink,
      "app.popoverBackground": surface,
      "app.popoverForeground": ink,
    },
  };
}
