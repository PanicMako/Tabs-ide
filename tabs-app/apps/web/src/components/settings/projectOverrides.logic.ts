export type OverrideChoice = "inherit" | "on" | "off";

export function overrideChoiceOf(value: boolean | undefined): OverrideChoice {
  if (value === undefined) return "inherit";
  return value ? "on" : "off";
}

/** What to send to the server: null clears the override so the project follows the global setting. */
export function overridePatchValue(choice: OverrideChoice): boolean | null {
  if (choice === "inherit") return null;
  return choice === "on";
}

export function overrideChoiceLabel(choice: OverrideChoice, globalValue: boolean): string {
  if (choice === "inherit") return `Same as everywhere (${globalValue ? "on" : "off"})`;
  return choice === "on" ? "On for this project" : "Off for this project";
}

export const OVERRIDE_CHOICES: ReadonlyArray<OverrideChoice> = ["inherit", "on", "off"];
