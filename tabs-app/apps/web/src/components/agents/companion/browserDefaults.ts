export type BrowserAppearance = "system" | "light" | "dark";

export interface BrowserDefaultsToApply {
  readonly zoomFactor?: number;
  readonly colorScheme?: Exclude<BrowserAppearance, "system">;
}

/**
 * The zoom and page appearance a browser tab should start with. Only a brand-new tab gets them:
 * a restored tab already has its own, and resetting it would undo what the user chose there.
 * Values equal to the browser's own defaults are left alone so nothing is changed needlessly.
 */
export function browserDefaultsToApply(input: {
  readonly isNewTab: boolean;
  readonly zoomFactor: number;
  readonly appearance: BrowserAppearance;
}): BrowserDefaultsToApply {
  if (!input.isNewTab) return {};
  return {
    ...(input.zoomFactor !== 1 ? { zoomFactor: input.zoomFactor } : {}),
    ...(input.appearance !== "system" ? { colorScheme: input.appearance } : {}),
  };
}

export function zoomLabel(zoomFactor: number): string {
  return `${Math.round(zoomFactor * 100)}%`;
}

/**
 * The profile a brand-new tab should open under: the chosen default, when it is not the built-in
 * one and still exists. Anything else leaves the choice to the browser, so deleting a profile
 * never strands new tabs.
 */
export function newTabProfileId(input: {
  readonly isNewTab: boolean;
  readonly defaultProfileId: string;
  readonly profileIds: ReadonlyArray<string>;
}): string | undefined {
  if (!input.isNewTab) return undefined;
  if (input.defaultProfileId === "default") return undefined;
  return input.profileIds.includes(input.defaultProfileId) ? input.defaultProfileId : undefined;
}
