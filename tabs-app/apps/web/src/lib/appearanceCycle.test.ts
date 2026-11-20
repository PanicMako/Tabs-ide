import { describe, expect, it } from "vitest";
import { nextAppearancePreference } from "./appearanceCycle";

describe("nextAppearancePreference", () => {
  it("cycles system, light, dark and back", () => {
    expect(nextAppearancePreference("system")).toBe("tabs-light");
    expect(nextAppearancePreference("tabs-light")).toBe("true-black");
    expect(nextAppearancePreference("true-black")).toBe("system");
  });

  it("starts a custom or named theme at system", () => {
    expect(nextAppearancePreference("custom")).toBe("system");
  });
});

describe("retired themes", () => {
  it("are not offered but still resolve", async () => {
    const { PICKABLE_THEME_DEFINITIONS, RETIRED_THEME_REPLACEMENTS, THEME_DEFINITIONS } =
      await import("./themes");
    expect(PICKABLE_THEME_DEFINITIONS.some((theme) => theme.id === "tabs-dark")).toBe(false);
    expect(RETIRED_THEME_REPLACEMENTS["tabs-dark"]).toBe("true-black");
    expect(THEME_DEFINITIONS["tabs-dark"]).toBeDefined();
    // Near-duplicates are gone entirely; a stored pick moves to the theme that stayed.
    for (const retired of ["ink", "aubergine", "espresso", "linen"]) {
      expect(retired in THEME_DEFINITIONS).toBe(false);
      expect(RETIRED_THEME_REPLACEMENTS[retired]! in THEME_DEFINITIONS).toBe(true);
    }
  });
});
