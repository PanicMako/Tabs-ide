import { describe, expect, it } from "vitest";
import {
  isTabsLogoVariant,
  resolveTabsLogoVariant,
  TABS_LOGO_VARIANTS,
  TABS_MARK,
  tabsLogoSvg,
} from "./tabsBrand";

describe("Tabs identity", () => {
  it("resolves legacy and system preferences without losing explicit treatments", () => {
    expect(resolveTabsLogoVariant("system", false)).toBe("blue-white");
    expect(resolveTabsLogoVariant("system", true)).toBe("ivory-ink");
    expect(resolveTabsLogoVariant("light", true)).toBe("blue-white");
    expect(resolveTabsLogoVariant("dark", false)).toBe("ivory-ink");
    for (const { id } of TABS_LOGO_VARIANTS) {
      expect(resolveTabsLogoVariant(id, false)).toBe(id);
      expect(resolveTabsLogoVariant(id, true)).toBe(id);
    }
    expect(isTabsLogoVariant("arbitrary-path")).toBe(false);
    expect(resolveTabsLogoVariant("retired", false)).toBe("blue-white");
  });
  it("keeps both pieces and negative-space eyes in every vector color treatment", () => {
    for (const variant of TABS_LOGO_VARIANTS.filter((item) => item.id !== "blue-ink")) {
      const svg = tabsLogoSvg(variant.id);
      expect(svg).toContain(TABS_MARK.main);
      expect(svg).toContain(TABS_MARK.detached);
      expect(svg).toContain('fill-rule="evenodd"');
      expect(svg).toContain(`fill="${variant.bg}"`);
      expect(svg.match(new RegExp(`fill="${variant.fg}"`, "g"))).toHaveLength(2);
      expect(tabsLogoSvg(variant.id, "horizontal")).toContain(TABS_MARK.wordmark);
    }
  });
  it("keeps the supplied fifth treatment as raster artwork, including portable exports", () => {
    expect(tabsLogoSvg("blue-ink")).toContain('href="/brand/blue-ink-master.png"');
    expect(tabsLogoSvg("blue-ink")).not.toContain(TABS_MARK.main);
    expect(tabsLogoSvg("blue-ink", "icon", "data:image/png;base64,exact")).toContain(
      'href="data:image/png;base64,exact"',
    );
  });
});
