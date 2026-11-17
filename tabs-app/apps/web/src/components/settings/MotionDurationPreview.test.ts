import { describe, expect, it } from "vitest";
import { previewTravelSeconds } from "./MotionDurationPreview";

describe("panel animation preview", () => {
  it("moves the dot in exactly the chosen duration, and parks it when off", () => {
    expect(previewTravelSeconds(200)).toBe(0.2);
    expect(previewTravelSeconds(400)).toBe(0.4);
    expect(previewTravelSeconds(0)).toBe(0);
  });
});
