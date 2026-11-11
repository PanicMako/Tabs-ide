/** Device frames the browser preview can emulate. Shared by every browser surface. */
export const BROWSER_DEVICE_PRESETS = [
  { id: "project-default", label: "Fit", kind: "fit", width: null, height: null },
  { id: "mobile-s", label: "iPhone 14 Pro", kind: "phone", width: 393, height: 852 },
  { id: "mobile-l", label: "iPhone 14 Pro Max", kind: "phone", width: 430, height: 932 },
  { id: "tablet", label: "iPad Air", kind: "tablet", width: 820, height: 1180 },
  { id: "desktop", label: "Laptop 13", kind: "laptop", width: 1280, height: 800 },
  { id: "wide", label: "Large Desktop", kind: "desktop", width: 1600, height: 960 },
  { id: "custom", label: "Custom size", kind: "custom", width: null, height: null },
] as const;

export type BrowserDevicePreset = (typeof BROWSER_DEVICE_PRESETS)[number];
export type BrowserDevicePresetId = BrowserDevicePreset["id"];

export interface BrowserViewportState {
  devicePreset: string;
  customWidth?: number | null | undefined;
  customHeight?: number | null | undefined;
  landscape?: boolean | undefined;
}

export function findBrowserDevicePreset(id: string): BrowserDevicePreset {
  return BROWSER_DEVICE_PRESETS.find((preset) => preset.id === id) ?? BROWSER_DEVICE_PRESETS[0];
}

/** The frame size actually shown, after rotation. Null means "fill the pane". */
export function resolveBrowserViewportSize(
  state: BrowserViewportState,
): { width: number; height: number } | null {
  const preset = findBrowserDevicePreset(state.devicePreset);
  const width = preset.id === "custom" ? state.customWidth : preset.width;
  const height = preset.id === "custom" ? state.customHeight : preset.height;
  if (!width || !height) return null;
  return state.landscape ? { width: height, height: width } : { width, height };
}

export function formatBrowserViewportLabel(state: BrowserViewportState): string {
  const preset = findBrowserDevicePreset(state.devicePreset);
  if (preset.id !== "custom") return preset.label;
  if (state.customWidth && state.customHeight) {
    return `${preset.label} ${state.customWidth} x ${state.customHeight}`;
  }
  return preset.label;
}

export const BROWSER_ZOOM_MIN = 0.5;
export const BROWSER_ZOOM_MAX = 2;
const BROWSER_ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

/** Step zoom through the same stops Chromium uses, instead of drifting by 0.1. */
export function stepBrowserZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) {
    return BROWSER_ZOOM_STEPS.find((step) => step > current + 0.001) ?? BROWSER_ZOOM_MAX;
  }
  return (
    [...BROWSER_ZOOM_STEPS].reverse().find((step) => step < current - 0.001) ?? BROWSER_ZOOM_MIN
  );
}
