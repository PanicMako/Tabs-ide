import { create } from "zustand";
import type { DeviceComparisonViewRef } from "@tabs/contracts";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMemoryStorage } from "~/lib/storage";
import type { RightPanelTab } from "./rightPanelStore";

export interface CompanionSurface {
  id: string;
  kind: RightPanelTab;
  url?: string;
  profileId?: string | undefined;
  pageRef?: string | undefined;
  browserInstanceId?: string | undefined;
  title?: string;
  selectedPath?: string | undefined;
  draftContents?: string | undefined;
  viewportWidth?: number;
  /** Device tabs: the simulator or emulator this tab watches. */
  hostId?: string;
  deviceId?: string;
  platform?: "ios" | "android";
  /** Read-only comparison outcome in the original thread. */
  deviceComparisonResult?: DeviceComparisonViewRef;
  /** Device tabs: shown in a window over the chat instead of inside the panel. */
  floating?: boolean;
  floatX?: number;
  floatY?: number;
  /** Side chat tabs: the hidden fork this tab shows. */
  sideChatThreadId?: string;
}
export interface CompanionWorkspace {
  tabs: CompanionSurface[];
  activeId: string | null;
}
export const EMPTY_COMPANION_WORKSPACE: CompanionWorkspace = { tabs: [], activeId: null };
interface CompanionSurfaceState {
  workspaces: Record<string, CompanionWorkspace>;
  open: (
    scope: string,
    kind: RightPanelTab,
    initial?: Partial<Omit<CompanionSurface, "id" | "kind">>,
  ) => string;
  activate: (scope: string, id: string) => void;
  moveBrowser: (sourceScope: string, destinationScope: string, id: string) => boolean;
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
      open: (scope, kind, initial) => {
        const workspace = get().workspaces[scope] ?? EMPTY_COMPANION_WORKSPACE;
        const existing =
          kind === "browser" || kind === "device" || kind === "sidechat"
            ? null
            : workspace.tabs.find((tab) => tab.kind === kind);
        const id = existing?.id ?? crypto.randomUUID();
        set((state) => ({
          workspaces: {
            ...state.workspaces,
            [scope]: {
              tabs: existing
                ? workspace.tabs.map((tab) => (tab.id === id ? { ...tab, ...initial } : tab))
                : [...workspace.tabs, { id, kind, ...initial }],
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
      moveBrowser: (sourceScope, destinationScope, id) => {
        let moved = false;
        set((state) => {
          const source = state.workspaces[sourceScope];
          const destination = state.workspaces[destinationScope] ?? EMPTY_COMPANION_WORKSPACE;
          const index = source?.tabs.findIndex((tab) => tab.id === id) ?? -1;
          const browser = source?.tabs[index];
          if (
            !source ||
            browser?.kind !== "browser" ||
            destination.tabs.some((tab) => tab.id === id)
          )
            return state;
          const remaining = source.tabs.filter((tab) => tab.id !== id);
          moved = true;
          return {
            workspaces: {
              ...state.workspaces,
              [sourceScope]: {
                tabs: remaining,
                activeId:
                  source.activeId === id
                    ? (remaining[Math.min(index, remaining.length - 1)]?.id ?? null)
                    : source.activeId,
              },
              [destinationScope]: {
                tabs: [...destination.tabs, browser],
                activeId: destination.activeId ?? id,
              },
            },
          };
        });
        return moved;
      },
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
