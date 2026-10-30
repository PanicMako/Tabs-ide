import { useCallback } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMemoryStorage } from "../../lib/storage";
export type WorkspaceActionSection = "git" | "run" | "agents";
type Preference = { open?: boolean; section?: WorkspaceActionSection; expanded?: boolean };
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
