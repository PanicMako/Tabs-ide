import { useCallback } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMemoryStorage } from "../../lib/storage";
export type WorkspaceActionSection = "git" | "run" | "agents" | "usage" | "look";
type Preference = {
  open?: boolean;
  section?: WorkspaceActionSection;
  expanded?: boolean;
  /** Providers pinned to this workspace's Usage tab (an older build stored one string). */
  usagePinned?: readonly string[] | string | null;
};
export const useWorkspaceActionsState = create<{
  entries: Record<string, Preference>;
  update: (key: string, patch: Preference) => void;
}>()(
  persist(
    (set) => ({
      entries: {},
      update: (key, patch) =>
        set((state) => ({
          entries: { ...state.entries, [key]: { ...state.entries[key], ...patch } },
        })),
    }),
    {
      name: "tabs:workspace-actions:v1",
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? createMemoryStorage() : window.localStorage,
      ),
      partialize: (state) => ({ entries: state.entries }),
    },
  ),
);
export function useWorkspaceActionExpansion(key: string) {
  const expanded = useWorkspaceActionsState((state) => state.entries[key]?.expanded ?? false);
  const setExpanded = useCallback(
    (value: boolean) => useWorkspaceActionsState.getState().update(key, { expanded: value }),
    [key],
  );
  return [expanded, setExpanded] as const;
}

const NO_PINS: readonly string[] = [];

/** Providers pinned to a workspace's Usage tab. Pinning one also reopens the card on Usage. */
export function useWorkspaceUsagePins(key: string) {
  const stored = useWorkspaceActionsState((state) => state.entries[key]?.usagePinned);
  const pinned = typeof stored === "string" ? [stored] : (stored ?? NO_PINS);
  const toggle = useCallback(
    (driver: string) => {
      const entry = useWorkspaceActionsState.getState().entries[key]?.usagePinned;
      const current = typeof entry === "string" ? [entry] : (entry ?? NO_PINS);
      const adding = !current.includes(driver);
      useWorkspaceActionsState.getState().update(key, {
        usagePinned: adding ? [...current, driver] : current.filter((id) => id !== driver),
        ...(adding ? { section: "usage" as const } : {}),
      });
    },
    [key],
  );
  return [pinned, toggle] as const;
}
