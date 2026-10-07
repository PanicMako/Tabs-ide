import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMemoryStorage } from "~/lib/storage";

export type RightPanelTab = "diff" | "browser" | "files" | "terminal" | "pr" | "stash" | "queue";

interface RightPanelState {
  readonly isOpen: boolean;
  readonly activeTab: RightPanelTab;
  setIsOpen: (isOpen: boolean) => void;
  setActiveTab: (tab: RightPanelTab) => void;
  toggleOpen: (tab?: RightPanelTab) => void;
  openPanel: (tab?: RightPanelTab) => void;
  closePanel: () => void;
}

const safeStorage = typeof localStorage !== "undefined" ? localStorage : createMemoryStorage();

export const useRightPanelStore = create<RightPanelState>()(
  persist(
    (set) => ({
      isOpen: true,
      activeTab: "diff",
      setIsOpen: (isOpen) => set({ isOpen }),
      setActiveTab: (tab) => set({ activeTab: tab }),
      toggleOpen: (tab) =>
        set((state) => ({
          isOpen: !state.isOpen,
          activeTab: tab ?? state.activeTab,
        })),
      openPanel: (tab) =>
        set((state) => ({
          isOpen: true,
          activeTab: tab ?? state.activeTab,
        })),
      closePanel: () => set({ isOpen: false }),
    }),
    {
      name: "tabs:right-panel-state:v3",
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({
        isOpen: state.isOpen,
        activeTab: state.activeTab,
      }),
    },
  ),
);
