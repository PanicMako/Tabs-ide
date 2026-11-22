import { create } from "zustand";

interface SessionSearchPanelState {
  readonly open: boolean;
  readonly initialQuery: string;
  readonly openPanel: (initialQuery?: string) => void;
  readonly closePanel: () => void;
}

/** Open state for the Session Search panel; the command palette and Quick Actions both set it. */
export const useSessionSearchStore = create<SessionSearchPanelState>()((set) => ({
  open: false,
  initialQuery: "",
  openPanel: (initialQuery = "") => set({ open: true, initialQuery }),
  closePanel: () => set({ open: false }),
}));

export const openSessionSearch = (initialQuery?: string) =>
  useSessionSearchStore.getState().openPanel(initialQuery);
