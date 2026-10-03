import { describe, expect, it } from "vitest";
import { COMPARISON_VIEWPORTS } from "./BrowserComparisonView";

describe("BrowserComparisonView constants & presets", () => {
  it("defines standard responsive device presets", () => {
    expect(COMPARISON_VIEWPORTS.length).toBeGreaterThanOrEqual(5);

    const mobile = COMPARISON_VIEWPORTS.find((v) => v.icon === "mobile");
    expect(mobile).toBeDefined();
    expect(mobile?.width).toBeLessThan(500);

    const desktop = COMPARISON_VIEWPORTS.find((v) => v.icon === "desktop");
    expect(desktop).toBeDefined();
    expect(desktop?.width).toBeGreaterThanOrEqual(1200);

    const tablet = COMPARISON_VIEWPORTS.find((v) => v.icon === "tablet");
    expect(tablet).toBeDefined();
    expect(tablet?.width).toBeGreaterThanOrEqual(700);
  });

  it("contains iPhone 14 preset with standard dimensions", () => {
    const iphone = COMPARISON_VIEWPORTS.find((v) => v.name.includes("iPhone 14"));
    expect(iphone).toBeDefined();
    expect(iphone?.width).toBe(390);
    expect(iphone?.height).toBe(844);
  });
});
