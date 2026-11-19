export interface QuitKeyProgress {
  readonly progress: number | null;
  readonly armed: boolean;
}

export type QuitKeyOverlayView =
  | { readonly visible: false }
  | { readonly visible: true; readonly label: string; readonly fill: number | null };

/** What the overlay says while a quit key is held or half pressed. */
export function quitKeyOverlayView(state: QuitKeyProgress, isMac: boolean): QuitKeyOverlayView {
  const chord = isMac ? "⌘Q" : "Ctrl+Q";
  if (state.progress !== null) {
    const fill = Math.min(1, Math.max(0, state.progress));
    return { visible: true, label: `Keep holding ${chord} to quit`, fill };
  }
  if (state.armed) return { visible: true, label: `Press ${chord} again to quit`, fill: null };
  return { visible: false };
}
