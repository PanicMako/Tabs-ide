import { describe, expect, it } from "vitest";
import { PROVIDER_ACCENT_CHOICES, withProviderAccent } from "./providerAccent";

describe("withProviderAccent", () => {
  it("sets, replaces and clears the accent without touching other fields", () => {
    const base = { driver: "codex", displayName: "Work", enabled: true };
    const blue = withProviderAccent(base, "#4f7cff");
    expect(blue).toEqual({ ...base, accentColor: "#4f7cff" });
    expect((withProviderAccent(blue, "#2f9e6e") as { accentColor?: string }).accentColor).toBe(
      "#2f9e6e",
    );
    expect(withProviderAccent(blue, null)).toEqual(base);
    expect("accentColor" in withProviderAccent(blue, null)).toBe(false);
  });
  it("offers distinct, valid hex colours", () => {
    const values = PROVIDER_ACCENT_CHOICES.map((choice) => choice.value);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });
});
