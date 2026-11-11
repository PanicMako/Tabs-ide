// Match the final airport tile's settle and highlight sequence.
export const SOLARI_TILE_SETTLE_MS = 250;
export const SOLARI_TILE_STAGGER_MS = 160;
export const SOLARI_TILE_HIGHLIGHT_MS = 380;
export const STARTUP_ANIMATION_HOLD_MS =
  SOLARI_TILE_SETTLE_MS + 7 * SOLARI_TILE_STAGGER_MS + SOLARI_TILE_HIGHLIGHT_MS;
/** The splash lifts away over this long once the workspace has painted. */
export const STARTUP_ANIMATION_EXIT_MS = 760;
/** The mascot's whole repair job plays before the app may reveal. */
export const MASCOT_INTRO_HOLD_MS = 6_500;

function isMascotLoader(loader: string): boolean {
  return loader === "mascot" || loader === "glass";
}

export function startupAnimationHoldMs(loader: string): number {
  return isMascotLoader(loader) ? MASCOT_INTRO_HOLD_MS : STARTUP_ANIMATION_HOLD_MS;
}

/** Long enough to read the count hitting 100 before the workspace arrives. */
export function startupExitBeatMs(loader: string): number {
  return isMascotLoader(loader) ? 420 : 0;
}

/** The mascot's workspace rises from the bottom; other loaders lift away. */
export function startupExitStyle(loader: string): "lift" | "rise" {
  return isMascotLoader(loader) ? "rise" : "lift";
}
