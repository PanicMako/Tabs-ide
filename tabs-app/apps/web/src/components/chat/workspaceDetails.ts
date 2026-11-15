import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createMemoryStorage } from "../../lib/storage";

/**
 * The parts of the workspace card a user can show or hide ("Show in thread
 * details"). Everything is shown until the user turns something off.
 */
export const WORKSPACE_DETAILS = [
  { id: "environment", label: "Environment and worktree" },
  { id: "editor", label: "Open in editor" },
  { id: "scripts", label: "Project scripts" },
  { id: "branch", label: "Branch and pull request" },
  { id: "git-actions", label: "Git actions" },
  { id: "changes", label: "Changes" },
  { id: "automations", label: "Automations" },
  { id: "context", label: "Context window" },
  { id: "usage", label: "Usage" },
] as const;

export type WorkspaceDetailId = (typeof WORKSPACE_DETAILS)[number]["id"];

const KNOWN = new Set<string>(WORKSPACE_DETAILS.map((detail) => detail.id));

export function isDetailShown(hidden: ReadonlyArray<string>, id: WorkspaceDetailId): boolean {
  return !hidden.includes(id);
}

/** Flips one detail; ids that no longer exist are dropped so saved state cannot grow stale. */
export function toggleDetail(hidden: ReadonlyArray<string>, id: WorkspaceDetailId): string[] {
  const kept = hidden.filter((entry) => KNOWN.has(entry));
  return kept.includes(id) ? kept.filter((entry) => entry !== id) : [...kept, id];
}

export const useWorkspaceDetails = create<{
  hidden: ReadonlyArray<string>;
  toggle: (id: WorkspaceDetailId) => void;
  showAll: () => void;
}>()(
  persist(
    (set) => ({
      hidden: [],
      toggle: (id) => set((state) => ({ hidden: toggleDetail(state.hidden, id) })),
      showAll: () => set({ hidden: [] }),
    }),
    {
      name: "tabs:workspace-details:v1",
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? createMemoryStorage() : window.localStorage,
      ),
    },
  ),
);

/** Whether a detail is shown, for use inside components. */
export function useDetailShown(id: WorkspaceDetailId): boolean {
  return useWorkspaceDetails((state) => isDetailShown(state.hidden, id));
}
