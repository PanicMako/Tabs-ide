import { describe, expect, it } from "vitest";
import { browserDefaultsToApply, zoomLabel } from "./browserDefaults";

describe("browserDefaultsToApply", () => {
  it("applies a non-default zoom and appearance to a new tab", () => {
    expect(
      browserDefaultsToApply({ isNewTab: true, zoomFactor: 1.25, appearance: "dark" }),
    ).toEqual({
      zoomFactor: 1.25,
      colorScheme: "dark",
    });
  });

  it("leaves values that match the browser's own defaults alone", () => {
    expect(browserDefaultsToApply({ isNewTab: true, zoomFactor: 1, appearance: "system" })).toEqual(
      {},
    );
  });

  it("never touches a restored tab", () => {
    expect(browserDefaultsToApply({ isNewTab: false, zoomFactor: 2, appearance: "light" })).toEqual(
      {},
    );
  });

  it("labels zoom as a percentage", () => {
    expect(zoomLabel(0.33)).toBe("33%");
    expect(zoomLabel(1.25)).toBe("125%");
  });
});
