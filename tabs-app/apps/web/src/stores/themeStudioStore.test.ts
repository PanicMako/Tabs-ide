import { beforeEach, describe, expect, it } from "vitest";
import { useThemeStudioStore } from "./themeStudioStore";

describe("themeStudioStore", () => {
  beforeEach(() => useThemeStudioStore.setState({ requested: false }));

  it("holds a request until the page takes it, once", () => {
    useThemeStudioStore.getState().request();
    expect(useThemeStudioStore.getState().consume()).toBe(true);
    expect(useThemeStudioStore.getState().consume()).toBe(false);
  });

  it("has nothing to take when nothing was requested", () => {
    expect(useThemeStudioStore.getState().consume()).toBe(false);
  });
});
