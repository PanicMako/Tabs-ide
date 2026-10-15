import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMemoryStorage } from "~/lib/storage";

interface WorkspaceAppearanceState {
  readonly showProjectTabIcons: boolean;
  readonly projectTabIconOverrides: Record<string, boolean>;
  setShowProjectTabIcons: (enabled: boolean) => void;
  toggleShowProjectTabIcons: () => void;
  setProjectTabIconOverride: (projectId: string, enabled: boolean | null) => void;
  isProjectTabIconVisible: (projectId?: string | null) => boolean;
}

const safeStorage = typeof localStorage !== "undefined" ? localStorage : createMemoryStorage();

export const useWorkspaceAppearanceStore = create<WorkspaceAppearanceState>()(
  persist(
    (set, get) => ({
      showProjectTabIcons: false,
      projectTabIconOverrides: {},
      setShowProjectTabIcons: (showProjectTabIcons) => set({ showProjectTabIcons }),
      toggleShowProjectTabIcons: () =>
        set((state) => ({ showProjectTabIcons: !state.showProjectTabIcons })),
      setProjectTabIconOverride: (projectId: string, enabled: boolean | null) =>
        set((state) => {
          const overrides = { ...state.projectTabIconOverrides };
          if (enabled === null) {
            delete overrides[projectId];
          } else {
            overrides[projectId] = enabled;
          }
          return { projectTabIconOverrides: overrides };
        }),
      isProjectTabIconVisible: (projectId?: string | null) => {
        if (!projectId) return get().showProjectTabIcons;
        const overrides = get().projectTabIconOverrides ?? {};
        const override = overrides[projectId];
        return override !== undefined ? override : get().showProjectTabIcons;
      },
    }),
    {
      name: "tabs_workspace_appearance_v1",
      storage: createJSONStorage(() => safeStorage),
    },
  ),
);
