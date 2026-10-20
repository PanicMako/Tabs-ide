import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMemoryStorage } from "~/lib/storage";

export type RightPanelTab = "diff" | "browser" | "files" | "terminal" | "pr" | "stash" | "queue";

interface RightPanelState {
  readonly isOpen: boolean;
  readonly maximized: boolean;
  setMaximized: (maximized: boolean) => void;
  readonly activeTab: RightPanelTab;
  readonly choosingSurface: boolean;
  setChoosingSurface: (choosing: boolean) => void;
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
      // On narrow windows this is a modal sheet. Do not cover a fresh workspace
      // until the user asks for a surface; persisted choices are still restored.
      isOpen: false,
      maximized: false,
      setMaximized: (maximized) => set({ maximized }),
      activeTab: "diff",
      choosingSurface: true,
      setChoosingSurface: (choosingSurface) => set({ choosingSurface }),
      setIsOpen: (isOpen) => set({ isOpen, ...(isOpen ? {} : { maximized: false }) }),
      setActiveTab: (tab) => set({ activeTab: tab, choosingSurface: false }),
      toggleOpen: (tab) =>
        set((state) => ({
          isOpen: !state.isOpen,
          maximized: state.isOpen ? false : state.maximized,
          activeTab: tab ?? state.activeTab,
          choosingSurface: tab ? false : state.choosingSurface,
        })),
      openPanel: (tab) =>
        set((state) => ({
          isOpen: true,
          activeTab: tab ?? state.activeTab,
          choosingSurface: tab ? false : state.choosingSurface,
        })),
      closePanel: () => set({ isOpen: false, maximized: false }),
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
