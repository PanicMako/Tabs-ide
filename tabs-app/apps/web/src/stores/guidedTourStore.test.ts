import { beforeEach, describe, expect, it } from "vitest";
import { GUIDED_TOUR_STEPS, useGuidedTourStore } from "./guidedTourStore";

describe("guidedTourStore", () => {
  beforeEach(() => {
    useGuidedTourStore.getState().resetTour();
  });

  it("initializes with step 0 and active status", () => {
    const state = useGuidedTourStore.getState();
    expect(state.currentStepIndex).toBe(0);
    expect(state.isDismissed).toBe(false);
    expect(GUIDED_TOUR_STEPS[0]!.id).toBe("add_project");
  });

  it("advances through the ordered tour and persists completion", () => {
    const store = useGuidedTourStore.getState();
    expect(GUIDED_TOUR_STEPS.map(({ id }) => id)).toEqual([
      "add_project",
      "project_tools",
      "themes",
      "workspace_settings",
      "quick_actions",
      "providers",
      "agents",
      "project_tabs",
    ]);
    for (let index = 1; index < GUIDED_TOUR_STEPS.length; index++) {
      store.nextStep();
      expect(useGuidedTourStore.getState().currentStepIndex).toBe(index);
    }
    store.nextStep();
    expect(useGuidedTourStore.getState().isDismissed).toBe(true);
  });

  it("replays the tour from the workspace step when a project is already open", () => {
    const store = useGuidedTourStore.getState();
    store.dismissTour();
    store.resetTour(true);
    expect(useGuidedTourStore.getState()).toMatchObject({
      currentStepIndex: 1,
      isStarted: true,
      isDismissed: false,
      isCollapsed: false,
    });
  });

  it("advances only when at the matching step with advanceIfAtStep", () => {
    const store = useGuidedTourStore.getState();
    // At step 0 ("add_project")
    store.advanceIfAtStep("workspace_settings"); // should not advance
    expect(useGuidedTourStore.getState().currentStepIndex).toBe(0);

    store.advanceIfAtStep("add_project"); // should advance
    expect(useGuidedTourStore.getState().currentStepIndex).toBe(1);
  });

  it("supports collapsing and dismissing", () => {
    const store = useGuidedTourStore.getState();
    expect(store.isCollapsed).toBe(false);

    store.toggleCollapsed();
    expect(useGuidedTourStore.getState().isCollapsed).toBe(true);

    store.dismissTour();
    expect(useGuidedTourStore.getState().isDismissed).toBe(true);

    // After dismissal, advanceIfAtStep must not advance
    store.advanceIfAtStep("add_project");
    expect(useGuidedTourStore.getState().currentStepIndex).toBe(0);
  });
});
