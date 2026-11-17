import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMemoryStorage } from "~/lib/storage";

export interface SavedLocalPage {
  readonly url: string;
}

interface BrowserLocalsState {
  readonly pages: ReadonlyArray<SavedLocalPage>;
  add: (url: string) => void;
  remove: (url: string) => void;
}

/** Local addresses the user saved on the browser's new tab page, newest first. */
export const useBrowserLocalsStore = create<BrowserLocalsState>()(
  persist(
    (set) => ({
      pages: [],
      add: (url) =>
        set((state) => ({
          pages: [{ url }, ...state.pages.filter((page) => page.url !== url)].slice(0, 12),
        })),
      remove: (url) => set((state) => ({ pages: state.pages.filter((page) => page.url !== url) })),
    }),
    {
      name: "tabs:browser-locals:v1",
      storage: createJSONStorage(() =>
        typeof localStorage !== "undefined" ? localStorage : createMemoryStorage(),
      ),
    },
  ),
);
