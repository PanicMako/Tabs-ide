import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMemoryStorage } from "~/lib/storage";
import type { RightPanelTab } from "./rightPanelStore";

export interface CompanionSurface {
  id: string;
  kind: RightPanelTab;
  url?: string;
  title?: string;
  selectedPath?: string | undefined;
  draftContents?: string | undefined;
  viewportWidth?: number;
}
export interface CompanionWorkspace {
  tabs: CompanionSurface[];
  activeId: string | null;
}
export const EMPTY_COMPANION_WORKSPACE: CompanionWorkspace = { tabs: [], activeId: null };
interface CompanionSurfaceState {
  workspaces: Record<string, CompanionWorkspace>;
  open: (scope: string, kind: RightPanelTab) => string;
  activate: (scope: string, id: string) => void;
  close: (scope: string, id: string) => void;
  update: (
    scope: string,
    id: string,
    changes: Partial<Omit<CompanionSurface, "id" | "kind">>,
  ) => void;
}
export const useCompanionSurfaceStore = create<CompanionSurfaceState>()(
  persist(
    (set, get) => ({
      workspaces: {},
      open: (scope, kind) => {
        const workspace = get().workspaces[scope] ?? EMPTY_COMPANION_WORKSPACE;
        const existing =
          kind === "browser" ? null : workspace.tabs.find((tab) => tab.kind === kind);
        const id = existing?.id ?? crypto.randomUUID();
        set((state) => ({
          workspaces: {
            ...state.workspaces,
            [scope]: {
              tabs: existing ? workspace.tabs : [...workspace.tabs, { id, kind }],
              activeId: id,
            },
          },
        }));
        return id;
      },
      activate: (scope, id) =>
        set((state) => {
          const workspace = state.workspaces[scope];
          if (!workspace?.tabs.some((tab) => tab.id === id)) return state;
          return { workspaces: { ...state.workspaces, [scope]: { ...workspace, activeId: id } } };
        }),
      close: (scope, id) =>
        set((state) => {
          const workspace = state.workspaces[scope];
          if (!workspace) return state;
          const index = workspace.tabs.findIndex((tab) => tab.id === id);
          const tabs = workspace.tabs.filter((tab) => tab.id !== id);
          return {
            workspaces: {
              ...state.workspaces,
              [scope]: {
                tabs,
                activeId:
                  workspace.activeId === id
                    ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null)
                    : workspace.activeId,
              },
            },
          };
        }),
      update: (scope, id, changes) =>
        set((state) => {
          const workspace = state.workspaces[scope];
          if (!workspace) return state;
          const current = workspace.tabs.find((tab) => tab.id === id);
          if (
            !current ||
            Object.entries(changes).every(
              ([key, value]) => current[key as keyof CompanionSurface] === value,
            )
          )
            return state;
          return {
            workspaces: {
              ...state.workspaces,
              [scope]: {
                ...workspace,
                tabs: workspace.tabs.map((tab) => (tab.id === id ? { ...tab, ...changes } : tab)),
              },
            },
          };
        }),
    }),
    {
      name: "tabs:companion-workspaces:v1",
      storage: createJSONStorage(() =>
        typeof localStorage !== "undefined" ? localStorage : createMemoryStorage(),
      ),
    },
  ),
);
