import { create } from "zustand";

interface ThemeStudioRequestState {
  /** Set when something (a shortcut) wants the studio open; the Themes page takes it when it mounts. */
  readonly requested: boolean;
  request: () => void;
  /** Returns whether a request was waiting, and clears it. */
  consume: () => boolean;
}

export const useThemeStudioStore = create<ThemeStudioRequestState>((set, get) => ({
  requested: false,
  request: () => set({ requested: true }),
  consume: () => {
    const waiting = get().requested;
    if (waiting) set({ requested: false });
    return waiting;
  },
}));
