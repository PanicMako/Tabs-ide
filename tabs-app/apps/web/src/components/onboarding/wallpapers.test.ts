import { beforeEach, describe, expect, it } from "vitest";
import {
  WALLPAPERS,
  WALLPAPER_CATEGORIES,
  getInitialWallpaper,
  saveWallpaperPreference,
} from "./wallpapers";

describe("wallpapers collection", () => {
  const store: Record<string, string> = {};

  beforeEach(() => {
    for (const key of Object.keys(store)) {
      delete store[key];
    }

    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
      key: (index: number) => Object.keys(store)[index] ?? null,
      length: Object.keys(store).length,
    };
  });

  it("contains exactly 30 curated wallpapers", () => {
    expect(WALLPAPERS.length).toBe(30);
  });

  it("ensures every wallpaper has required metadata and valid URLs", () => {
    const urls = new Set<string>();
    const ids = new Set<string>();

    for (const wp of WALLPAPERS) {
      expect(wp.id).toBeDefined();
      expect(wp.label.length).toBeGreaterThan(0);
      expect(wp.url.startsWith("/wallpapers/")).toBe(true);
      expect(wp.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(wp.description.length).toBeGreaterThan(0);
      expect(WALLPAPER_CATEGORIES).toContain(wp.category);

      // Unique IDs and URLs
      expect(ids.has(wp.id)).toBe(false);
      expect(urls.has(wp.url)).toBe(false);
      ids.add(wp.id);
      urls.add(wp.url);
    }
  });

  it("covers multiple atmospheric aesthetic categories", () => {
    const categories = new Set(WALLPAPERS.map((w) => w.category));
    expect(categories.has("Sky")).toBe(true);
    expect(categories.has("Sunset")).toBe(true);
    expect(categories.has("Night")).toBe(true);
    expect(categories.has("Nature")).toBe(true);
    expect(categories.has("Pastel")).toBe(true);
    expect(categories.has("Places")).toBe(true);
    expect(categories.has("Scenery")).toBe(true);
  });

  it("handles preference persistence gracefully", () => {
    const initial = getInitialWallpaper();
    expect(initial).toBeDefined();
    expect(initial.url).toBe(WALLPAPERS[0]!.url);

    saveWallpaperPreference(WALLPAPERS[5]!.url);
    const updated = getInitialWallpaper();
    expect(updated.url).toBe(WALLPAPERS[5]!.url);

    // Invalid URL fallback
    saveWallpaperPreference("/invalid/path.jpg");
    const fallback = getInitialWallpaper();
    expect(fallback.url).toBe(WALLPAPERS[0]!.url);
  });
});
