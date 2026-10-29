import { describe, expect, it } from "vitest";
import { PROVIDER_BRAND_ICONS, resolveProviderIcon } from "./providerIcons";

describe("shared provider brands", () => {
  it("resolves every supported provider for headers and sidebars", () => {
    expect(Object.keys(PROVIDER_BRAND_ICONS)).toHaveLength(10);
    for (const [driver, icon] of Object.entries(PROVIDER_BRAND_ICONS)) {
      expect(resolveProviderIcon(driver)).toBe(icon);
      expect(resolveProviderIcon("custom-work-account", driver)).toBe(icon);
    }
  });
  it("prefers the configured driver and supports legacy identifiers", () => {
    expect(resolveProviderIcon("claude-account", "openrouter")).toBe(
      PROVIDER_BRAND_ICONS.openrouter,
    );
    expect(resolveProviderIcon("openrouter-personal")).toBe(PROVIDER_BRAND_ICONS.openrouter);
    expect(resolveProviderIcon("claude")).toBe(PROVIDER_BRAND_ICONS.claudeAgent);
  });
});
