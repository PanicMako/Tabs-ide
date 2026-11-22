// The airport board settles tile by tile, left to right. The reveal is driven
// by the last tile actually landing (see SplashScreen's onIntroComplete), not by
// a fixed hold, so these only pace the flips themselves.
export const SOLARI_TILE_SETTLE_MS = 90;
export const SOLARI_TILE_STAGGER_MS = 48;
export const SOLARI_TILE_HIGHLIGHT_MS = 160;
export const SOLARI_TILE_COUNT = 8;
/** When the last tile lands, for previews and tests. Not a reveal gate. */
export const SOLARI_BOARD_SETTLED_MS =
  SOLARI_TILE_SETTLE_MS + (SOLARI_TILE_COUNT - 1) * SOLARI_TILE_STAGGER_MS;
/**
 * Safety net only: if a loader never reports that its intro finished (it
 * errored or was never painted), reveal anyway instead of trapping the user.
 * Kept well past any intro's length, because startup is the busiest moment
 * and intros can run slow then; a shorter net cut animations off midway.
 */
export const SOLARI_INTRO_FALLBACK_MS = 4_000;
/**
 * The workspace rises from the bottom edge to the top over this long, as one
 * full, visible sweep. Every loader uses the same rise.
 */
export const STARTUP_RISE_EXIT_MS = 820;
/** @deprecated Every loader now shares STARTUP_RISE_EXIT_MS. */
export const STARTUP_ANIMATION_EXIT_MS = STARTUP_RISE_EXIT_MS;
/** @deprecated Every loader now shares STARTUP_RISE_EXIT_MS. */
export const SOLARI_RISE_EXIT_MS = STARTUP_RISE_EXIT_MS;
function isMascotLoader(loader: string): boolean {
  return loader === "mascot" || loader === "glass";
}

/** Every loader reports its own landing: the board's last tile, the mascot's last beat. */
export function startupIntroIsSignalled(_loader: string): boolean {
  return true;
}

/** No loader holds on a fixed timer any more; each reveals when it lands. */
export function startupAnimationHoldMs(_loader: string): number {
  return 0;
}

export function startupExitMs(_loader: string): number {
  return STARTUP_RISE_EXIT_MS;
}

/**
 * The finished board holds this long after its last tile lands, so the
 * workspace never starts rising while a card is still settling.
 */
export const SOLARI_EXIT_BEAT_MS = 100;
/** A landed mascot holds a touch longer, long enough to read the lockup. */
export const MASCOT_MOTION_EXIT_BEAT_MS = 180;

/** A short beat after the loader's intro before the workspace rises. */
export function startupExitBeatMs(loader: string): number {
  return isMascotLoader(loader) ? MASCOT_MOTION_EXIT_BEAT_MS : SOLARI_EXIT_BEAT_MS;
}

/** Every loader hands off by the workspace rising up from the bottom. */
export function startupExitStyle(_loader: string): "lift" | "rise" {
  return "rise";
}
