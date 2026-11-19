import { describe, expect, it } from "vitest";
import { browserDefaultsToApply, newTabProfileId, zoomLabel } from "./browserDefaults";

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

describe("newTabProfileId", () => {
  const profileIds = ["personal", "work"];

  it("opens a new tab under the chosen default profile", () => {
    expect(newTabProfileId({ isNewTab: true, defaultProfileId: "work", profileIds })).toBe("work");
  });

  it("leaves the choice to the browser for the built-in default, a missing profile or a restored tab", () => {
    expect(
      newTabProfileId({ isNewTab: true, defaultProfileId: "default", profileIds }),
    ).toBeUndefined();
    expect(
      newTabProfileId({ isNewTab: true, defaultProfileId: "deleted", profileIds }),
    ).toBeUndefined();
    expect(
      newTabProfileId({ isNewTab: false, defaultProfileId: "work", profileIds }),
    ).toBeUndefined();
  });
});
