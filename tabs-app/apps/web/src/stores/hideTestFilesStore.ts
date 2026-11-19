import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMemoryStorage } from "~/lib/storage";

interface HideTestFilesState {
  readonly hidden: boolean;
  setHidden: (hidden: boolean) => void;
}

const safeStorage = typeof localStorage !== "undefined" ? localStorage : createMemoryStorage();

/** Whether diffs leave out test files, remembered between sessions. */
export const useHideTestFilesStore = create<HideTestFilesState>()(
  persist((set) => ({ hidden: false, setHidden: (hidden) => set({ hidden }) }), {
    name: "tabs:hide-test-files:v1",
    storage: createJSONStorage(() => safeStorage),
  }),
);
