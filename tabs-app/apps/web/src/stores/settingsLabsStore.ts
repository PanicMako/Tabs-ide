import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMemoryStorage } from "~/lib/storage";

interface SettingsLabsState {
  editorialSettings: boolean;
  editorialAppearance: "dark" | "light";
  setEditorialAppearance: (appearance: "dark" | "light") => void;
  setEditorialSettings: (enabled: boolean) => void;
}
const safeStorage = typeof localStorage !== "undefined" ? localStorage : createMemoryStorage();
export const useSettingsLabsStore = create<SettingsLabsState>()(
  persist(
    (set) => ({
      editorialSettings: false,
      editorialAppearance: "dark",
      setEditorialAppearance: (editorialAppearance) => set({ editorialAppearance }),
      setEditorialSettings: (editorialSettings) => set({ editorialSettings }),
    }),
    {
      name: "tabs_settings_labs_v1",
      storage: createJSONStorage(() => safeStorage),
      partialize: ({ editorialSettings, editorialAppearance }) => ({
        editorialSettings,
        editorialAppearance,
      }),
    },
  ),
);
