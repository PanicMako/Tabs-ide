import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMemoryStorage } from "../../lib/storage";

export type DockLayout = "focus" | "columns" | "rows" | "main-stack" | "quad";
export const DOCK_LAYOUTS: { id: DockLayout; label: string; slots: number }[] = [
  { id: "focus", label: "Focus", slots: 1 },
  { id: "columns", label: "Side by side", slots: 2 },
  { id: "rows", label: "Top and bottom", slots: 2 },
  { id: "main-stack", label: "Main and stack", slots: 3 },
  { id: "quad", label: "Four panes", slots: 4 },
];
export interface DockView {
  layout: DockLayout;
  slots: (string | null)[];
  selected: string | null;
  inspector: boolean;
  services?: boolean;
  stream: boolean;
}
export const DEFAULT_DOCK_VIEW: DockView = {
  layout: "focus",
  slots: [null, null, null, null],
  selected: null,
  inspector: false,
  services: true,
  stream: false,
};
export function assignDockSlot(slots: (string | null)[], id: string, index: number) {
  const next = [...slots];
  const previous = next.indexOf(id);
  if (previous >= 0) next[previous] = next[index] ?? null;
  next[index] = id;
  return next;
}
export const useDockState = create<{
  views: Record<string, DockView>;
  update: (scope: string, patch: Partial<DockView>) => void;
}>()(
  persist(
    (set) => ({
      views: {},
      update: (scope, patch) =>
        set((state) => ({
          views: {
            ...state.views,
            [scope]: { ...DEFAULT_DOCK_VIEW, ...state.views[scope], ...patch },
          },
        })),
    }),
    {
      name: "tabs:dock-layout:v1",
      version: 1,
      migrate: (persisted) => {
        const previous = (persisted ?? {}) as { views?: Record<string, DockView> };
        return {
          views: Object.fromEntries(
            Object.entries(previous.views ?? {}).map(([scope, view]) => [
              scope,
              { ...view, services: true },
            ]),
          ),
        };
      },
      storage: createJSONStorage(() =>
        typeof localStorage === "undefined" ? createMemoryStorage() : localStorage,
      ),
      partialize: (state) => ({ views: state.views }),
    },
  ),
);
