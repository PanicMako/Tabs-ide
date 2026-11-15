import { beforeEach, describe, expect, it, vi } from "vitest";

function installLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  });
  vi.stubGlobal("window", { dispatchEvent: () => true });
  vi.stubGlobal(
    "CustomEvent",
    class {
      constructor(public type: string) {}
    },
  );
}

describe("per-project wallpapers", () => {
  beforeEach(() => {
    vi.resetModules();
    installLocalStorage();
  });

  it("falls back to the shared wallpaper when nothing is assigned", async () => {
    const wallpapers = await import("./wallpapers");
    const shared = wallpapers.getInitialAgentWallpaper();
    expect(wallpapers.resolveWallpaperForThread("t1", "p1").url).toBe(shared.url);
  });

  it("lets one project have its own wallpaper without changing another's", async () => {
    const wallpapers = await import("./wallpapers");
    const [first, second] = wallpapers.WALLPAPERS;
    wallpapers.saveProjectWallpaper("project-a", second!.url);
    expect(wallpapers.resolveWallpaperForThread("t1", "project-a").url).toBe(second!.url);
    expect(wallpapers.resolveWallpaperForThread("t2", "project-b").url).toBe(
      wallpapers.getInitialAgentWallpaper().url,
    );
    expect(first!.url).not.toBe(second!.url);
  });

  it("prefers a thread's own wallpaper over its project's, and clearing falls back", async () => {
    const wallpapers = await import("./wallpapers");
    const [, second, third] = wallpapers.WALLPAPERS;
    wallpapers.saveProjectWallpaper("project-a", second!.url);
    wallpapers.saveThreadWallpaper("thread-1", third!.url);
    expect(wallpapers.resolveWallpaperForThread("thread-1", "project-a").url).toBe(third!.url);
    wallpapers.clearThreadWallpaper("thread-1");
    expect(wallpapers.resolveWallpaperForThread("thread-1", "project-a").url).toBe(second!.url);
    wallpapers.clearProjectWallpaper("project-a");
    expect(wallpapers.resolveWallpaperForThread("thread-1", "project-a").url).toBe(
      wallpapers.getInitialAgentWallpaper().url,
    );
  });
});
