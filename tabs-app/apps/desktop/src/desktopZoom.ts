import type { MenuItemConstructorOptions } from "electron";

/** The displayed percentage is relative to the platform's comfortable UI scale. */
export function desktopZoomFactor(platform: NodeJS.Platform, relativeFactor = 1): number {
  const relative = Number.isFinite(relativeFactor)
    ? Math.min(1.5, Math.max(0.75, relativeFactor))
    : 1;
  return relative * (platform === "win32" ? 0.85 : 1);
}

export function desktopZoomMenu(
  platform: NodeJS.Platform,
  dispatch: (action: string) => void,
): MenuItemConstructorOptions[] {
  if (platform !== "win32") {
    return [
      { role: "resetZoom" },
      { role: "zoomIn", accelerator: "CmdOrCtrl+=" },
      { role: "zoomIn", accelerator: "CmdOrCtrl+Plus", visible: false },
      { role: "zoomOut" },
    ];
  }
  // Native Electron roles reset to physical 1.0 and bypass the saved relative
  // percentage. Route Windows accelerators through the same controls as Settings.
  return [
    { label: "Reset Zoom", accelerator: "Ctrl+0", click: () => dispatch("zoom-reset") },
    { label: "Zoom In", accelerator: "Ctrl+=", click: () => dispatch("zoom-in") },
    {
      label: "Zoom In",
      accelerator: "Ctrl+Plus",
      visible: false,
      click: () => dispatch("zoom-in"),
    },
    { label: "Zoom Out", accelerator: "Ctrl+-", click: () => dispatch("zoom-out") },
  ];
}
