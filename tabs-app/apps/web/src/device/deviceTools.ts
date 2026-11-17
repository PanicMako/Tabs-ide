import type { DeviceActionInput, DeviceDetail, DevicePlatform } from "@tabs/contracts";

export type DeviceToggle = Extract<DeviceActionInput, { type: "setToggle" }>["setting"];

export interface DeviceToolToggle {
  readonly setting: DeviceToggle;
  readonly label: string;
}

/** Toggles per platform; a toggle shows only when the device read a value for it back. */
export function visibleToolToggles(
  platform: DevicePlatform,
  detail: DeviceDetail | null,
): DeviceToolToggle[] {
  const all: ReadonlyArray<DeviceToolToggle & { platforms: DevicePlatform[] }> = [
    { setting: "reduceMotion", label: "Reduce motion", platforms: ["ios", "android"] },
    { setting: "increaseContrast", label: "Increase contrast", platforms: ["ios"] },
    { setting: "reduceTransparency", label: "Reduce transparency", platforms: ["ios"] },
    { setting: "showBorders", label: "Show element frames", platforms: ["ios", "android"] },
    { setting: "voiceOver", label: "VoiceOver", platforms: ["ios"] },
    { setting: "networkEnabled", label: "Network", platforms: ["android"] },
  ];
  return all
    .filter((item) => item.platforms.includes(platform))
    .filter((item) => detail?.settings[item.setting] !== undefined)
    .map(({ setting, label }) => ({ setting, label }));
}

export const supportsPush = (platform: DevicePlatform) => platform === "ios";
export const supportsOrientation = (platform: DevicePlatform) => platform === "android";
export const supportsLiquidGlass = (detail: DeviceDetail | null) =>
  detail?.settings.liquidGlass !== undefined;
