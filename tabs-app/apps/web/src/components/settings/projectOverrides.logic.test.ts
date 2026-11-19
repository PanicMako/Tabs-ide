import { describe, expect, it } from "vitest";
import {
  OVERRIDE_CHOICES,
  overrideChoiceLabel,
  overrideChoiceOf,
  overridePatchValue,
} from "./projectOverrides.logic";

describe("project override choices", () => {
  it("reads a missing override as following the global setting", () => {
    expect(overrideChoiceOf(undefined)).toBe("inherit");
    expect(overrideChoiceOf(true)).toBe("on");
    expect(overrideChoiceOf(false)).toBe("off");
  });

  it("round-trips every choice, clearing the override for inherit", () => {
    expect(overridePatchValue("inherit")).toBeNull();
    for (const choice of OVERRIDE_CHOICES) {
      const value = overridePatchValue(choice);
      expect(overrideChoiceOf(value === null ? undefined : value)).toBe(choice);
    }
  });

  it("says what following the global setting means right now", () => {
    expect(overrideChoiceLabel("inherit", true)).toBe("Same as everywhere (on)");
    expect(overrideChoiceLabel("inherit", false)).toBe("Same as everywhere (off)");
    expect(overrideChoiceLabel("off", true)).toBe("Off for this project");
  });
});
