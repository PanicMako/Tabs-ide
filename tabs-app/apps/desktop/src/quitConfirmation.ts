/**
 * Decides when a quit shortcut should really quit. Pure, so the timing can be
 * tested without Electron: the main process feeds it key events and a clock.
 *
 * - direct: the first press quits.
 * - hold: the key must stay down for `holdMs`; a tap does nothing.
 * - double-click: a second press within `doublePressMs` quits.
 */
export type QuitConfirmationMode = "direct" | "hold" | "double-click";

export const QUIT_HOLD_MS = 900;
export const QUIT_DOUBLE_PRESS_MS = 1500;

export interface QuitConfirmationState {
  readonly heldSince: number | null;
  readonly lastPressAt: number | null;
}

export const INITIAL_QUIT_CONFIRMATION: QuitConfirmationState = {
  heldSince: null,
  lastPressAt: null,
};

export interface QuitConfirmationStep {
  readonly state: QuitConfirmationState;
  readonly quit: boolean;
  /** 0 to 1 while a hold is filling, for an overlay. Null when nothing is in progress. */
  readonly progress: number | null;
  /** True after a first press in double-click mode, so the UI can say "press again". */
  readonly armed: boolean;
}

interface Timing {
  readonly holdMs?: number;
  readonly doublePressMs?: number;
}

function step(
  state: QuitConfirmationState,
  quit: boolean,
  progress: number | null,
  armed = false,
): QuitConfirmationStep {
  return { state, quit, progress, armed };
}

/** A key went down (key repeat counts as the same press while held). */
export function quitKeyDown(
  mode: QuitConfirmationMode,
  state: QuitConfirmationState,
  now: number,
  timing: Timing = {},
): QuitConfirmationStep {
  const holdMs = timing.holdMs ?? QUIT_HOLD_MS;
  const doublePressMs = timing.doublePressMs ?? QUIT_DOUBLE_PRESS_MS;
  if (mode === "direct") return step(INITIAL_QUIT_CONFIRMATION, true, null);
  if (mode === "hold") {
    const heldSince = state.heldSince ?? now;
    const progress = Math.min(1, Math.max(0, (now - heldSince) / holdMs));
    return step({ heldSince, lastPressAt: state.lastPressAt }, progress >= 1, progress);
  }
  // Key repeat from a held key must not count as a second press.
  if (state.heldSince !== null) {
    return step(state, false, null, state.lastPressAt !== null);
  }
  const second = state.lastPressAt !== null && now - state.lastPressAt <= doublePressMs;
  if (second) return step(INITIAL_QUIT_CONFIRMATION, true, null);
  return step({ heldSince: now, lastPressAt: now }, false, null, true);
}

/** The key came up: a tap in hold mode is forgotten, and a double-click press can repeat. */
export function quitKeyUp(
  mode: QuitConfirmationMode,
  state: QuitConfirmationState,
  now: number,
  timing: Timing = {},
): QuitConfirmationStep {
  const doublePressMs = timing.doublePressMs ?? QUIT_DOUBLE_PRESS_MS;
  if (mode === "hold") return step(INITIAL_QUIT_CONFIRMATION, false, null);
  if (mode === "double-click") {
    const lastPressAt =
      state.lastPressAt !== null && now - state.lastPressAt <= doublePressMs
        ? state.lastPressAt
        : null;
    return step({ heldSince: null, lastPressAt }, false, null, lastPressAt !== null);
  }
  return step(INITIAL_QUIT_CONFIRMATION, false, null);
}
