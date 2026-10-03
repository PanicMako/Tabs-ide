import { describe, expect, it } from "vitest";
import { resolveEffectiveReducedMotion } from "./panelAnimations";

describe("panelAnimations and reduced motion resolution", () => {
  it("forces reduced motion when preference is always", () => {
    expect(resolveEffectiveReducedMotion("always", false)).toBe(true);
    expect(resolveEffectiveReducedMotion("always", true)).toBe(true);
  });

  it("forces animations when preference is never", () => {
    expect(resolveEffectiveReducedMotion("never", true)).toBe(false);
    expect(resolveEffectiveReducedMotion("never", false)).toBe(false);
  });

  it("follows system preference when set to system or undefined", () => {
    expect(resolveEffectiveReducedMotion("system", true)).toBe(true);
    expect(resolveEffectiveReducedMotion("system", false)).toBe(false);
    expect(resolveEffectiveReducedMotion(undefined, true)).toBe(true);
    expect(resolveEffectiveReducedMotion(undefined, false)).toBe(false);
  });
});
