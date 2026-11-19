import { beforeEach, describe, expect, it } from "vitest";
import { useHideTestFilesStore } from "./hideTestFilesStore";

describe("hideTestFilesStore", () => {
  beforeEach(() => useHideTestFilesStore.setState({ hidden: false }));

  it("shows test files until asked to hide them", () => {
    expect(useHideTestFilesStore.getInitialState().hidden).toBe(false);
  });

  it("remembers the choice", () => {
    useHideTestFilesStore.getState().setHidden(true);
    expect(useHideTestFilesStore.getState().hidden).toBe(true);
  });
});
