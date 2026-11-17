import type {
  DeviceHostId,
  DevicePlatform,
  DeviceServiceState,
  DeviceSummary,
} from "@tabs/contracts";

/** The three plain steps of first-run setup, and which are done. */
export type DeviceSetupStepId = "hub" | "platforms" | "agents";

export interface DeviceSetupStep {
  readonly id: DeviceSetupStepId;
  readonly done: boolean;
}

/**
 * Setup is complete once the user finished it, or a host already has the hub
 * installed and was configured earlier. Opening the panel never starts anything,
 * so this only reads state.
 */
export function deviceSetupSteps(state: DeviceServiceState | null): ReadonlyArray<DeviceSetupStep> {
  const hubReady =
    !!state &&
    (state.hostStatus === "ready" ||
      state.hostStatus === "starting" ||
      state.hosts.some((host) => host.hubInstalled));
  return [
    { id: "hub", done: hubReady },
    { id: "platforms", done: hubReady && !!state?.onboardingCompleted },
    { id: "agents", done: !!state?.onboardingCompleted },
  ];
}

export function isDeviceSetupComplete(state: DeviceServiceState | null): boolean {
  return !!state && state.onboardingCompleted && state.hostStatus !== "disabled";
}

export interface DevicePlatformNote {
  readonly platform: DevicePlatform;
  readonly available: boolean;
  /** The exact fix, or null when the platform works. */
  readonly fix: string | null;
}

const IOS_FIX = "iOS needs macOS with Xcode installed. Install Xcode, open it once, then refresh.";
const ANDROID_FIX =
  "Android needs the SDK Platform-Tools, Android Emulator and Command-line Tools (latest), plus a virtual device from Android Studio's Device Manager. Set ANDROID_HOME for a custom SDK location, restart the server, then refresh. Emulator video also needs ffmpeg with libx264 on PATH (or SERVE_EMU_FFMPEG).";

/** Per-platform availability with the fix text for whatever is missing. */
export function devicePlatformNotes(state: DeviceServiceState | null): DevicePlatformNote[] {
  const platforms: DevicePlatform[] = ["ios", "android"];
  return platforms.map((platform) => {
    const entries = (state?.hosts ?? []).flatMap((host) =>
      host.platforms.filter((item) => item.platform === platform),
    );
    const available = entries.some((entry) => entry.available);
    if (available) return { platform, available, fix: null };
    const reason = entries.find((entry) => entry.reason)?.reason;
    const fix = platform === "ios" ? IOS_FIX : ANDROID_FIX;
    return { platform, available, fix: reason ? `${reason} ${fix}` : fix };
  });
}

export interface DevicePickerGroup {
  readonly hostId: DeviceHostId;
  readonly label: string;
  readonly devices: ReadonlyArray<DeviceSummary>;
}

/** Running devices first, then by name; grouped by host label only when several hosts exist. */
export function groupDevicesByHost(state: DeviceServiceState | null): DevicePickerGroup[] {
  if (!state) return [];
  const sorted = [...state.devices].toSorted(
    (a, b) => Number(b.booted) - Number(a.booted) || a.name.localeCompare(b.name),
  );
  return state.hosts
    .map((host) => ({
      hostId: host.id,
      label: host.label,
      devices: sorted.filter((device) => device.hostId === host.id),
    }))
    .filter((group) => group.devices.length > 0);
}

export function isDeviceBooting(state: DeviceServiceState | null, device: DeviceSummary): boolean {
  return !!state?.bootingDevices?.some(
    (item) => item.hostId === device.hostId && item.id === device.id,
  );
}

/** Live video needs a secure page; plain-HTTP remote origins fall back to still frames. */
export function canStreamVideo(location: { protocol: string; hostname: string }): boolean {
  return (
    location.protocol === "https:" ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "[::1]"
  );
}

/** Hardware buttons the controls rail shows for a platform. */
export function deviceRailButtons(platform: DevicePlatform): ReadonlyArray<string> {
  return platform === "android"
    ? ["home", "back", "recents", "power"]
    : ["home", "rotate", "power"];
}
