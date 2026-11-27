import type { DesktopUpdateState } from "@tabs/contracts";

export function shouldBroadcastDownloadProgress(
  currentState: DesktopUpdateState,
  nextPercent: number,
): boolean {
  if (currentState.status !== "downloading") {
    return true;
  }

  const currentPercent = currentState.downloadPercent;
  if (currentPercent === null) {
    return true;
  }

  const previousStep = Math.floor(currentPercent / 10);
  const nextStep = Math.floor(nextPercent / 10);
  return nextStep !== previousStep || nextPercent === 100;
}

export function nextStatusAfterDownloadFailure(
  currentState: DesktopUpdateState,
): DesktopUpdateState["status"] {
  return currentState.availableVersion ? "available" : "error";
}

export function getCanRetryAfterDownloadFailure(currentState: DesktopUpdateState): boolean {
  return currentState.availableVersion !== null;
}

export function getAutoUpdateDisabledReason(args: {
  isDevelopment: boolean;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  appImage?: string | undefined;
  /** `process.windowsStore`: true when running from a Microsoft Store AppX/MSIX package. */
  windowsStore?: boolean | undefined;
  disabledByEnv: boolean;
}): string | null {
  if (args.isDevelopment || !args.isPackaged) {
    return "Automatic updates are only available in packaged production builds.";
  }
  if (args.disabledByEnv) {
    return "Automatic updates are disabled by the TABS_DISABLE_AUTO_UPDATE setting.";
  }
  // Store packages are updated by the Microsoft Store; the NSIS updater must
  // never replace files inside the read-only package directory.
  if (args.platform === "win32" && args.windowsStore) {
    return "Updates for the Microsoft Store version are delivered by the Microsoft Store.";
  }
  if (args.platform === "linux" && !args.appImage) {
    return "Automatic updates on Linux require running the AppImage build. Packages installed with the .deb must be updated by installing the newer .deb.";
  }
  return null;
}
