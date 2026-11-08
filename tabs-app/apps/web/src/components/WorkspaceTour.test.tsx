import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceTour } from "./WorkspaceTour";
import { WORKSPACE_SETUP_STEP, useGuidedTourStore } from "../stores/guidedTourStore";

vi.mock("../stores/guidedTourStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../stores/guidedTourStore")>();
  return {
    ...actual,
    useGuidedTourStore: Object.assign(
      () => actual.useGuidedTourStore.getState(),
      actual.useGuidedTourStore,
    ),
  };
});

const renderTour = (hasProject = true) =>
  renderToStaticMarkup(
    <WorkspaceTour
      tools={[
        { id: "agents", kind: "agents", label: "Agents" },
        { id: "code", kind: "code", label: "Code" },
        { id: "server", kind: "server", label: "Dock" },
      ]}
      activeToolId="code"
      hasProject={hasProject}
      settingsSection={null}
      settingsTool={null}
      onSelectTool={vi.fn()}
      onChooseProject={vi.fn()}
      onOpenSettings={vi.fn()}
      onReturnToProject={vi.fn()}
      canLeaveSettings={() => true}
    />,
  );

describe("WorkspaceTour", () => {
  beforeEach(() => {
    useGuidedTourStore.getState().resetTour(true);
  });

  it("guides the first project without a preview dialog", () => {
    useGuidedTourStore.getState().resetTour();
    const markup = renderTour(false);
    expect(markup).toContain("Start with a project");
    expect(markup).toContain("Choose a project");
    expect(markup).toContain("Skip tour");
    expect(markup).not.toContain('data-slot="workspace-tour-overlay"');
    expect(markup).not.toContain("Explore Code");
  });

  it("lets a user explore the current tool and continue explicitly", () => {
    expect(renderTour()).toContain("Explore Code");
    useGuidedTourStore.getState().setExploring(true);
    expect(renderTour()).toContain("Resume workspace tour");
    useGuidedTourStore.getState().setCollapsed(false);
    const markup = renderTour();
    expect(markup).toContain("Get familiar with Code");
    expect(markup).toContain("Next");
    expect(markup).toContain('data-slot="workspace-tour-overlay"');
  });

  it("offers Browser and Terminal setup as optional actions", () => {
    useGuidedTourStore.getState().setStepIndex(WORKSPACE_SETUP_STEP);
    const markup = renderTour();
    expect(markup).toContain("Open Workspace Settings");
    expect(markup).not.toContain("Add a Browser tab");
    useGuidedTourStore.getState().setExploring(true);
    useGuidedTourStore.getState().setCollapsed(false);
    expect(renderTour()).toContain("Optional setup");
    expect(markup).toContain("Next");
  });

  it("keeps a small resume button when minimized", () => {
    useGuidedTourStore.getState().setCollapsed(true);
    expect(renderTour()).toContain("Resume workspace tour");
    expect(renderTour()).not.toContain("Explore Code");
  });

  it("stays dismissed after skipping", () => {
    useGuidedTourStore.getState().dismissTour();
    expect(renderTour()).toBe("");
  });
});
