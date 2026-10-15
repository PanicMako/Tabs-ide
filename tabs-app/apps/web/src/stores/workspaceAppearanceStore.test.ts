import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceAppearanceStore } from "./workspaceAppearanceStore";

describe("workspaceAppearanceStore", () => {
  beforeEach(() => {
    useWorkspaceAppearanceStore.setState({
      showProjectTabIcons: false,
      projectTabIconOverrides: {},
    });
  });

  it("defaults showProjectTabIcons to false and projectTabIconOverrides to empty", () => {
    expect(useWorkspaceAppearanceStore.getState().showProjectTabIcons).toBe(false);
    expect(useWorkspaceAppearanceStore.getState().projectTabIconOverrides).toEqual({});
  });

  it("updates showProjectTabIcons via setter", () => {
    useWorkspaceAppearanceStore.getState().setShowProjectTabIcons(true);
    expect(useWorkspaceAppearanceStore.getState().showProjectTabIcons).toBe(true);

    useWorkspaceAppearanceStore.getState().setShowProjectTabIcons(false);
    expect(useWorkspaceAppearanceStore.getState().showProjectTabIcons).toBe(false);
  });

  it("toggles showProjectTabIcons", () => {
    useWorkspaceAppearanceStore.getState().toggleShowProjectTabIcons();
    expect(useWorkspaceAppearanceStore.getState().showProjectTabIcons).toBe(true);

    useWorkspaceAppearanceStore.getState().toggleShowProjectTabIcons();
    expect(useWorkspaceAppearanceStore.getState().showProjectTabIcons).toBe(false);
  });

  it("manages per-project tab icon overrides", () => {
    // Project A overridden to false, Project B overridden to true
    useWorkspaceAppearanceStore.getState().setProjectTabIconOverride("proj-a", false);
    useWorkspaceAppearanceStore.getState().setProjectTabIconOverride("proj-b", true);

    expect(useWorkspaceAppearanceStore.getState().projectTabIconOverrides).toEqual({
      "proj-a": false,
      "proj-b": true,
    });

    // Check visibility resolution
    expect(useWorkspaceAppearanceStore.getState().isProjectTabIconVisible("proj-a")).toBe(false);
    expect(useWorkspaceAppearanceStore.getState().isProjectTabIconVisible("proj-b")).toBe(true);
    // Un-overridden project C falls back to global default (false)
    expect(useWorkspaceAppearanceStore.getState().isProjectTabIconVisible("proj-c")).toBe(false);
    // null/undefined project falls back to global default
    expect(useWorkspaceAppearanceStore.getState().isProjectTabIconVisible(null)).toBe(false);

    // If global default changes to true, un-overridden project follows it, overridden stays put
    useWorkspaceAppearanceStore.getState().setShowProjectTabIcons(true);
    expect(useWorkspaceAppearanceStore.getState().isProjectTabIconVisible("proj-a")).toBe(false);
    expect(useWorkspaceAppearanceStore.getState().isProjectTabIconVisible("proj-b")).toBe(true);
    expect(useWorkspaceAppearanceStore.getState().isProjectTabIconVisible("proj-c")).toBe(true);

    // Reset override by passing null
    useWorkspaceAppearanceStore.getState().setProjectTabIconOverride("proj-b", null);
    expect(useWorkspaceAppearanceStore.getState().projectTabIconOverrides).toEqual({
      "proj-a": false,
    });
    // Now proj-b falls back to global (true)
    expect(useWorkspaceAppearanceStore.getState().isProjectTabIconVisible("proj-b")).toBe(true);
  });
});
