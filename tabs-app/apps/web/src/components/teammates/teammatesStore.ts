import type { TeammatesSnapshot } from "@tabs/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMemoryStorage } from "~/lib/storage";

/** Live teammates data, fed by TeammatesHost while the Labs switch is on. */
interface TeammatesDataState {
  snapshot: TeammatesSnapshot | null;
  error: string | null;
  setSnapshot: (snapshot: TeammatesSnapshot | null) => void;
  setError: (error: string | null) => void;
}

export const useTeammatesStore = create<TeammatesDataState>()((set) => ({
  snapshot: null,
  error: null,
  setSnapshot: (snapshot) => set({ snapshot, error: null }),
  setError: (error) => set({ error }),
}));

const safeStorage = typeof localStorage !== "undefined" ? localStorage : createMemoryStorage();

/** Per-viewer conveniences: the focused teammate, the pinned avatar, the intro, whether the avatar shows. */
interface TeammatesUiState {
  /** The teammate selected in the Teammates space and used by Quick Actions and the palette. */
  activeTeammateId: string | null;
  /** The teammate the floating avatar shows. Falls back to the first teammate. */
  pinnedTeammateId: string | null;
  cornerHidden: boolean;
  /** The first-run intro was dismissed. */
  introSeen: boolean;
  panelOpen: boolean;
  /** What the Teammates space shows: a teammate, or the New teammate flow. */
  spaceMode: "teammate" | "new";
  /** Bumped to ask the host to open a teammate's home chat (quick action, palette). */
  homeRequest: { teammateId: string | null; nonce: number } | null;
  setActiveTeammateId: (id: string | null) => void;
  setPinnedTeammateId: (id: string | null) => void;
  setCornerHidden: (hidden: boolean) => void;
  setIntroSeen: (seen: boolean) => void;
  setPanelOpen: (open: boolean) => void;
  setSpaceMode: (mode: "teammate" | "new") => void;
  requestHome: (teammateId?: string | null) => void;
}

export const useTeammatesUiStore = create<TeammatesUiState>()(
  persist(
    (set) => ({
      activeTeammateId: null,
      pinnedTeammateId: null,
      // Minimised by default: the teammate lives in the top bar as a pair of eyes until you bring
      // its floating avatar out.
      cornerHidden: true,
      introSeen: false,
      panelOpen: false,
      spaceMode: "teammate",
      homeRequest: null,
      setActiveTeammateId: (activeTeammateId) => set({ activeTeammateId }),
      setPinnedTeammateId: (pinnedTeammateId) => set({ pinnedTeammateId }),
      setCornerHidden: (cornerHidden) => set({ cornerHidden }),
      setIntroSeen: (introSeen) => set({ introSeen }),
      setPanelOpen: (panelOpen) =>
        set(panelOpen ? { panelOpen } : { panelOpen, spaceMode: "teammate" }),
      setSpaceMode: (spaceMode) => set({ spaceMode }),
      requestHome: (teammateId = null) =>
        set((state) => ({
          homeRequest: { teammateId, nonce: (state.homeRequest?.nonce ?? 0) + 1 },
        })),
    }),
    {
      name: "tabs_teammates_ui_v1",
      // v2: everyone starts minimised in the top bar, including those who had the avatar floating.
      version: 2,
      migrate: (persisted, version) =>
        version < 2 ? { ...(persisted as object), cornerHidden: true } : persisted,
      storage: createJSONStorage(() => safeStorage),
      partialize: ({ activeTeammateId, pinnedTeammateId, cornerHidden, introSeen }) => ({
        activeTeammateId,
        pinnedTeammateId,
        cornerHidden,
        introSeen,
      }),
    },
  ),
);

/** Opens the Teammates space, on a teammate when given. */
export function openTeammatesPanel(teammateId?: string) {
  const state = useTeammatesUiStore.getState();
  if (teammateId) state.setActiveTeammateId(teammateId);
  state.setSpaceMode("teammate");
  state.setPanelOpen(true);
}

/** Opens the Teammates space on the New teammate flow. */
export function openNewTeammate() {
  const state = useTeammatesUiStore.getState();
  state.setSpaceMode("new");
  state.setPanelOpen(true);
}

/**
 * Where the docked icon was when it was clicked, so the avatar can fly out from there. A plain
 * value, not state: the avatar reads it once as it mounts and clears it.
 */
export const dockFlight: { from: { x: number; y: number } | null } = { from: null };
