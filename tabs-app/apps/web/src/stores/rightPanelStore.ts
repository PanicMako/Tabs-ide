import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMemoryStorage } from "~/lib/storage";

export type RightPanelTab = "diff" | "stash" | "queue";

interface RightPanelState {
  readonly activeTab: RightPanelTab;
  setActiveTab: (tab: RightPanelTab) => void;
}

const safeStorage = typeof localStorage !== "undefined" ? localStorage : createMemoryStorage();

export const useRightPanelStore = create<RightPanelState>()(
  persist(
    (set) => ({
      activeTab: "diff",
      setActiveTab: (tab) => set({ activeTab: tab }),
    }),
    {
      name: "tabs:right-panel-tab:v1",
      storage: createJSONStorage(() => safeStorage),
    },
  ),
);
