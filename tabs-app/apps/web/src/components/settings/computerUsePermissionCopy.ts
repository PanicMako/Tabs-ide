import type { ComputerUsePermissionStatus } from "@tabs/contracts";

export interface PermissionLine {
  readonly label: string;
  readonly detail: string;
  readonly ok: boolean | null;
}

/** Plain-language rows for the "Check permissions" result; `ok: null` means macOS gave no answer. */
export function describeComputerUsePermissions(
  status: ComputerUsePermissionStatus,
): ReadonlyArray<PermissionLine> {
  if (!status.platformSupported) {
    return [
      { label: "Platform", detail: "Computer use is not available on this platform.", ok: false },
    ];
  }
  if (!status.runtimeAvailable) {
    return [
      {
        label: "Windows runtime",
        detail: "Could not download the computer-use runtime. Check your connection and try again.",
        ok: false,
      },
    ];
  }
  return [
    {
      label: "Accessibility",
      ok: status.accessibility,
      detail: status.accessibility
        ? "Granted. Agents can read and control app windows."
        : "Not granted. Enable Tabs in System Settings > Privacy & Security > Accessibility.",
    },
    {
      label: "Screen Recording",
      ok: status.screenRecording === "unknown" ? null : status.screenRecording === "granted",
      detail:
        status.screenRecording === "granted"
          ? "Granted. Agents can take window screenshots."
          : status.screenRecording === "denied"
            ? "Not granted. Enable Tabs in System Settings > Privacy & Security > Screen Recording for screenshots."
            : "Could not be determined. Open an app window and check again.",
    },
  ];
}

export const ACCESSIBILITY_PANE_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
export const SCREEN_RECORDING_PANE_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

export interface SetupStep {
  readonly id: "accessibility" | "screen-recording";
  readonly title: string;
  readonly detail: string;
  readonly state: "granted" | "missing" | "unknown";
  readonly optional: boolean;
  readonly paneUrl: string;
}

/** The two-step guided setup, in order, derived from the live permission status. */
export function computerUseSetupSteps(status: ComputerUsePermissionStatus): SetupStep[] {
  return [
    {
      id: "accessibility",
      title: "Let Tabs control apps",
      detail: status.accessibility
        ? "Allowed. Agents can read windows and click, type and scroll in them."
        : "Open System Settings, find Tabs in the Accessibility list and switch it on.",
      state: status.accessibility ? "granted" : "missing",
      optional: false,
      paneUrl: ACCESSIBILITY_PANE_URL,
    },
    {
      id: "screen-recording",
      title: "Let Tabs see windows",
      detail:
        status.screenRecording === "granted"
          ? "Allowed. Agents can take screenshots of app windows."
          : status.screenRecording === "denied"
            ? "Optional. Switch Tabs on in the Screen Recording list so agents can take screenshots."
            : "Optional. If screenshots fail, switch Tabs on in the Screen Recording list.",
      state:
        status.screenRecording === "granted"
          ? "granted"
          : status.screenRecording === "denied"
            ? "missing"
            : "unknown",
      optional: true,
      paneUrl: SCREEN_RECORDING_PANE_URL,
    },
  ];
}

/** Computer use works as soon as Accessibility is granted; screenshots are a bonus. */
export const computerUseReady = (status: ComputerUsePermissionStatus): boolean =>
  status.platformSupported && status.runtimeAvailable && status.accessibility;
