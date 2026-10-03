import type { BrowserWindowConstructorOptions } from "electron";

export function resolveWindowControlsOverlay(isDark: boolean) {
  return { color: "#00000000", symbolColor: isDark ? "#cfcfcf" : "#202020", height: 52 };
}

export function resolveDesktopTitleBarOptions(
  platform: NodeJS.Platform,
  isDark: boolean,
): Pick<
  BrowserWindowConstructorOptions,
  "titleBarStyle" | "trafficLightPosition" | "titleBarOverlay"
> {
  if (platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 18 },
      titleBarOverlay: true,
    };
  }
  if (platform === "win32") {
    return { titleBarStyle: "hidden", titleBarOverlay: resolveWindowControlsOverlay(isDark) };
  }
  return { titleBarStyle: "default" };
}

export function updateWindowControlsOverlay(
  platform: NodeJS.Platform,
  windows: Iterable<{
    isDestroyed(): boolean;
    setTitleBarOverlay(options: ReturnType<typeof resolveWindowControlsOverlay>): void;
  } | null>,
  isDark: boolean,
): void {
  if (platform !== "win32") return;
  for (const window of windows) {
    if (window && !window.isDestroyed())
      window.setTitleBarOverlay(resolveWindowControlsOverlay(isDark));
  }
}
