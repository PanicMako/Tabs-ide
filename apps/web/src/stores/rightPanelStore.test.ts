import { beforeEach, describe, expect, it } from "vitest";
import { useRightPanelStore, type RightPanelTab } from "./rightPanelStore";

describe("rightPanelStore", () => {
  beforeEach(() => {
    useRightPanelStore.setState({
      isOpen: true,
      activeTab: "diff",
    });
  });

  it("defaults to open with diff tab", () => {
    const state = useRightPanelStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.activeTab).toBe("diff");
  });

  it("opens panel and optionally switches tab", () => {
    useRightPanelStore.getState().openPanel("browser");
    expect(useRightPanelStore.getState().isOpen).toBe(true);
    expect(useRightPanelStore.getState().activeTab).toBe("browser");

    useRightPanelStore.getState().openPanel("files");
    expect(useRightPanelStore.getState().isOpen).toBe(true);
    expect(useRightPanelStore.getState().activeTab).toBe("files");
  });

  it("toggles panel open and closed", () => {
    // Starts open, so toggle closes it
    useRightPanelStore.getState().toggleOpen("terminal");
    expect(useRightPanelStore.getState().isOpen).toBe(false);
    expect(useRightPanelStore.getState().activeTab).toBe("terminal");

    // Toggle again opens it
    useRightPanelStore.getState().toggleOpen();
    expect(useRightPanelStore.getState().isOpen).toBe(true);
  });

  it("closes panel cleanly", () => {
    useRightPanelStore.getState().openPanel("pr");
    expect(useRightPanelStore.getState().isOpen).toBe(true);

    useRightPanelStore.getState().closePanel();
    expect(useRightPanelStore.getState().isOpen).toBe(false);
    // Tab selection is preserved when closed
    expect(useRightPanelStore.getState().activeTab).toBe("pr");
  });

  it("supports all companion tab types", () => {
    const tabs: RightPanelTab[] = ["diff", "browser", "files", "terminal", "pr", "stash", "queue"];
    for (const tab of tabs) {
      useRightPanelStore.getState().setActiveTab(tab);
      expect(useRightPanelStore.getState().activeTab).toBe(tab);
    }
  });
});
