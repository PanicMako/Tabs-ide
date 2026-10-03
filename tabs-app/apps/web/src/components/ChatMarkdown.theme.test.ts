import { describe, expect, it } from "vitest";
import { resolveDiffThemeName } from "../lib/diffRendering";
import { THEME_DEFINITIONS } from "../lib/themes";

function resolveThemeVariant(
  activeThemeId: string,
  customBaseVariant: "light" | "dark" = "light",
): "light" | "dark" {
  if (activeThemeId === "custom") {
    return customBaseVariant;
  }
  const def = THEME_DEFINITIONS[activeThemeId as keyof typeof THEME_DEFINITIONS];
  return def?.baseVariant ?? "dark";
}

describe("ChatMarkdown Theme Resolution & Contrast Verification", () => {
  it("resolves custom light theme to 'light' and pierre-light diff theme", () => {
    const resolved = resolveThemeVariant("custom", "light");
    expect(resolved).toBe("light");
    expect(resolveDiffThemeName(resolved)).toBe("pierre-light");
  });

  it("resolves custom dark theme to 'dark' and pierre-dark diff theme", () => {
    const resolved = resolveThemeVariant("custom", "dark");
    expect(resolved).toBe("dark");
    expect(resolveDiffThemeName(resolved)).toBe("pierre-dark");
  });

  it("resolves built-in tabs-light to 'light' and pierre-light diff theme", () => {
    const resolved = resolveThemeVariant("tabs-light");
    expect(resolved).toBe("light");
    expect(resolveDiffThemeName(resolved)).toBe("pierre-light");
  });

  it("resolves built-in tabs-dark to 'dark' and pierre-dark diff theme", () => {
    const resolved = resolveThemeVariant("tabs-dark");
    expect(resolved).toBe("dark");
    expect(resolveDiffThemeName(resolved)).toBe("pierre-dark");
  });
});
