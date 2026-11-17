import { describe, expect, it } from "vitest";
import { nextAppearancePreference } from "./appearanceCycle";

describe("nextAppearancePreference", () => {
  it("cycles system, light, dark and back", () => {
    expect(nextAppearancePreference("system")).toBe("tabs-light");
    expect(nextAppearancePreference("tabs-light")).toBe("tabs-dark");
    expect(nextAppearancePreference("tabs-dark")).toBe("system");
  });

  it("starts a custom or named theme at system", () => {
    expect(nextAppearancePreference("custom")).toBe("system");
  });
});
