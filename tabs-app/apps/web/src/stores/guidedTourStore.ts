import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMemoryStorage, type StateStorage } from "../lib/storage";

export const GUIDED_TOUR_STORAGE_KEY = "tabs:welcome-tour-dismissed:v1";

export const GUIDED_TOUR_STEPS = [
  { id: "add_project" },
  { id: "project_tools" },
  { id: "themes" },
  { id: "workspace_settings" },
  { id: "quick_actions" },
  { id: "providers" },
  { id: "agents" },
  { id: "project_tabs" },
] as const;

export const WORKSPACE_SETUP_STEP = GUIDED_TOUR_STEPS.findIndex(
  ({ id }) => id === "workspace_settings",
);

export type GuidedTourStepId = (typeof GUIDED_TOUR_STEPS)[number]["id"];

export type TourProjectTool = "browser" | "terminal" | "preset";

export function readTourProjectTool(search: string): TourProjectTool | null {
  const value = new URLSearchParams(search).get("tourTool");
  return value === "browser" || value === "terminal" || value === "preset" ? value : null;
}

interface GuidedTourState {
  currentStepIndex: number;
  toolCursor: number;
  isExploring: boolean;
  setExploring: (isExploring: boolean) => void;
  setToolCursor: (index: number) => void;
  isStarted: boolean;
  isDismissed: boolean;
  isCollapsed: boolean;
  setStepIndex: (index: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  dismissTour: () => void;
  resetTour: (hasProject?: boolean) => void;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  advanceIfAtStep: (stepId: GuidedTourStepId) => void;
}

const memoryFallbackStorage = createMemoryStorage();
const safeStorage: StateStorage = {
  getItem: (name) =>
    typeof localStorage !== "undefined"
      ? localStorage.getItem(name)
      : memoryFallbackStorage.getItem(name),
  setItem: (name, value) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(name, value);
    } else {
      memoryFallbackStorage.setItem(name, value);
    }
  },
  removeItem: (name) => {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(name);
    } else {
      memoryFallbackStorage.removeItem(name);
    }
  },
};

export const useGuidedTourStore = create<GuidedTourState>()(
  persist(
    (set, get) => ({
      currentStepIndex: 0,
      toolCursor: 0,
      isExploring: false,
      setExploring: (isExploring) =>
        set({ isExploring, ...(isExploring ? { isCollapsed: true } : {}) }),
      setToolCursor: (toolCursor) => set({ toolCursor, isExploring: false }),
      isStarted: false,
      isDismissed: false,
      isCollapsed: false,
      setStepIndex: (index) =>
        set({
          currentStepIndex: Math.max(0, Math.min(index, GUIDED_TOUR_STEPS.length - 1)),
          isExploring: false,
        }),
      nextStep: () => {
        const { currentStepIndex } = get();
        if (currentStepIndex >= GUIDED_TOUR_STEPS.length - 1) {
          set({ isDismissed: true });
        } else {
          set({ currentStepIndex: currentStepIndex + 1, isExploring: false });
        }
      },
      prevStep: () => {
        const { currentStepIndex } = get();
        set({ currentStepIndex: Math.max(0, currentStepIndex - 1), isExploring: false });
      },
      dismissTour: () => {
        set({ isDismissed: true });
      },
      resetTour: (hasProject = false) => {
        set({
          currentStepIndex: hasProject ? 1 : 0,
          toolCursor: 0,
          isExploring: false,
          isStarted: true,
          isDismissed: false,
          isCollapsed: false,
        });
      },
      setCollapsed: (isCollapsed) => set({ isCollapsed }),
      toggleCollapsed: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
      advanceIfAtStep: (stepId) => {
        const { currentStepIndex, isDismissed } = get();
        if (isDismissed || !get().isStarted) return;
        const currentStep = GUIDED_TOUR_STEPS[currentStepIndex];
        if (currentStep && currentStep.id === stepId) {
          if (currentStepIndex >= GUIDED_TOUR_STEPS.length - 1) {
            set({ isDismissed: true });
          } else {
            set({ currentStepIndex: currentStepIndex + 1, isExploring: false });
          }
        }
      },
    }),
    {
      name: GUIDED_TOUR_STORAGE_KEY,
      storage: createJSONStorage(() => safeStorage),
      version: 3,
      migrate: (persisted, version) => {
        const previous = persisted as Partial<GuidedTourState> | null;
        const index = previous?.currentStepIndex ?? 0;
        return {
          currentStepIndex:
            version === 2
              ? index >= 4
                ? index + 1
                : index
              : version === 1 && index === 2
                ? WORKSPACE_SETUP_STEP
                : index > 0
                  ? 1
                  : 0,
          isExploring: version === 2 && previous?.isExploring === true,
          isCollapsed: version === 2 && previous?.isCollapsed === true,
          toolCursor: previous?.toolCursor ?? 0,
          isStarted: previous?.isStarted ?? index > 0,
          isDismissed: persisted === true || previous?.isDismissed === true,
        };
      },
      partialize: (state) => ({
        isStarted: state.isStarted,
        currentStepIndex: state.currentStepIndex,
        toolCursor: state.toolCursor,
        isExploring: state.isExploring,
        isCollapsed: state.isCollapsed,
        isDismissed: state.isDismissed,
      }),
    },
  ),
);
