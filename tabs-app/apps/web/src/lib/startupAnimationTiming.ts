// Match the final airport tile's settle and highlight sequence.
export const SOLARI_TILE_SETTLE_MS = 250;
export const SOLARI_TILE_STAGGER_MS = 160;
export const SOLARI_TILE_HIGHLIGHT_MS = 380;
export const STARTUP_ANIMATION_HOLD_MS =
  SOLARI_TILE_SETTLE_MS + 7 * SOLARI_TILE_STAGGER_MS + SOLARI_TILE_HIGHLIGHT_MS;
export const STARTUP_ANIMATION_EXIT_MS = 500;

export function startupAnimationHoldMs(loader: string): number {
  return loader === "glass" ? 6_750 : STARTUP_ANIMATION_HOLD_MS;
}
