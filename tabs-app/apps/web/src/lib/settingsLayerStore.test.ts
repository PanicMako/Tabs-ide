import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeSettingsLayer,
  goToSettings,
  openSettingsLayer,
  useSettingsLayerStore,
} from "./settingsLayerStore";

describe("Settings layer", () => {
  beforeEach(() => {
    useSettingsLayerStore.setState({ open: false, hosted: false, mounted: false, section: null });
  });

  it("stays mounted after closing, so reopening and Back never rebuild a screen", () => {
    openSettingsLayer("usage");
    expect(useSettingsLayerStore.getState()).toMatchObject({
      open: true,
      mounted: true,
      section: "usage",
    });
    closeSettingsLayer();
    expect(useSettingsLayerStore.getState()).toMatchObject({ open: false, mounted: true });
    openSettingsLayer();
    expect(useSettingsLayerStore.getState().section).toBe("usage");
  });

  it("opens the layer when the workspace hosts it, and the route otherwise", () => {
    const navigate = vi.fn();
    goToSettings(navigate, "notifications");
    expect(navigate).toHaveBeenCalledWith({
      to: "/settings",
      search: { section: "notifications" },
    });
    expect(useSettingsLayerStore.getState().open).toBe(false);

    useSettingsLayerStore.setState({ hosted: true });
    goToSettings(navigate);
    expect(navigate).toHaveBeenCalledOnce();
    expect(useSettingsLayerStore.getState().open).toBe(true);
  });
});
