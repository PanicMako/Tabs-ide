// The airport board settles tile by tile, left to right. The reveal is driven
// by the last tile actually landing (see SplashScreen's onIntroComplete), not by
// a fixed hold, so these only pace the flips themselves.
export const SOLARI_TILE_SETTLE_MS = 200;
export const SOLARI_TILE_STAGGER_MS = 110;
export const SOLARI_TILE_HIGHLIGHT_MS = 380;
export const SOLARI_TILE_COUNT = 8;
/** When the last tile lands, for previews and tests. Not a reveal gate. */
export const SOLARI_BOARD_SETTLED_MS =
  SOLARI_TILE_SETTLE_MS + (SOLARI_TILE_COUNT - 1) * SOLARI_TILE_STAGGER_MS;
/**
 * Safety net only: if the board never reports that it settled (it errored or
 * was never painted), reveal anyway instead of trapping the user on the splash.
 */
export const SOLARI_INTRO_FALLBACK_MS = 4_000;
/** The splash lifts away over this long once the workspace has painted. */
export const STARTUP_ANIMATION_EXIT_MS = 760;
/** The workspace rises over the settled board a little quicker than a lift. */
export const SOLARI_RISE_EXIT_MS = 620;
/** The mascot's whole repair job plays before the app may reveal. */
export const MASCOT_INTRO_HOLD_MS = 6_500;

function isMascotLoader(loader: string): boolean {
  return loader === "mascot" || loader === "glass";
}

/**
 * True when the loader tells us itself that its intro finished. The mascot is
 * a scripted gag that keeps its fixed hold; the board reports its last tile.
 */
export function startupIntroIsSignalled(loader: string): boolean {
  return !isMascotLoader(loader);
}

/** Minimum time the loader holds before revealing; 0 when the loader signals. */
export function startupAnimationHoldMs(loader: string): number {
  return isMascotLoader(loader) ? MASCOT_INTRO_HOLD_MS : 0;
}

export function startupExitMs(loader: string): number {
  return isMascotLoader(loader) ? STARTUP_ANIMATION_EXIT_MS : SOLARI_RISE_EXIT_MS;
}

/**
 * The finished board holds this long after its last tile lands, so the
 * workspace never starts rising while a card is still settling.
 */
export const SOLARI_EXIT_BEAT_MS = 260;

/** A short beat after the loader's intro before the workspace rises. */
export function startupExitBeatMs(loader: string): number {
  // The mascot needs long enough to read the count hitting 100.
  return isMascotLoader(loader) ? 420 : SOLARI_EXIT_BEAT_MS;
}

/** Every loader hands off by the workspace rising up from the bottom. */
export function startupExitStyle(_loader: string): "lift" | "rise" {
  return "rise";
}
