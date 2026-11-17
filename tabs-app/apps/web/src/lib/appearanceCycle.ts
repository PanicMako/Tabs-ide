import type { ThemePreference } from "./themes";

const APPEARANCE_ORDER: ReadonlyArray<ThemePreference> = ["system", "tabs-light", "tabs-dark"];

/** Next step of the light / dark / system cycle. Any other theme starts the cycle at system. */
export function nextAppearancePreference(current: ThemePreference): ThemePreference {
  const index = APPEARANCE_ORDER.indexOf(current);
  if (index < 0) return "system";
  return APPEARANCE_ORDER[(index + 1) % APPEARANCE_ORDER.length] ?? "system";
}
