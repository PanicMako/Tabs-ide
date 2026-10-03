import type { DesktopUpdateActionResult, DesktopUpdateState } from "@tabs/contracts";

export type DesktopUpdateButtonAction = "download" | "install" | "none";

export function getDesktopUpdateReleaseNotesPreview(state: DesktopUpdateState): string | null {
  const notes = state.releaseNotes
    ?.replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[-*]\s+/gm, "• ")
    .trim();
  if (!notes) return null;
  return notes.length > 360 ? `${notes.slice(0, 357).trimEnd()}…` : notes;
}

export function describeDesktopUpdate(state: DesktopUpdateState): string {
  const previewNotice =
    state.distribution === "unsigned-preview"
      ? " This preview build verifies updates with the Tabs release key, but is not Apple-notarized."
      : "";
  switch (state.status) {
    case "disabled":
      return "Automatic updates are disabled for this build.";
    case "checking":
      return `Checking for updates…${previewNotice}`;
    case "up-to-date":
      return `Tabs is up to date.${previewNotice}`;
    case "available":
      return `Version ${state.availableVersion ?? ""} is available to download.${previewNotice}`.trim();
    case "downloading":
      return `Downloading update${
        typeof state.downloadPercent === "number" ? ` (${Math.floor(state.downloadPercent)}%)` : ""
      }…${previewNotice}`;
    case "downloaded":
      return `Version ${
        state.downloadedVersion ?? state.availableVersion ?? ""
      } is ready. Restart to install.${previewNotice}`.trim();
    case "installing":
      return `Preparing to restart and install the update…${previewNotice}`;
    case "error":
      return state.message ?? "The last update attempt failed.";
    default:
      return "Tabs is up to date.";
  }
}

export function resolveDesktopUpdateButtonAction(
  state: DesktopUpdateState,
): DesktopUpdateButtonAction {
  if (state.status === "available") {
    return "download";
  }
  if (state.status === "downloaded") {
    return "install";
  }
  if (state.status === "error") {
    if (state.errorContext === "install" && state.downloadedVersion) {
      return "install";
    }
    if (state.errorContext === "download" && state.availableVersion) {
      return "download";
    }
  }
  return "none";
}

export function shouldShowDesktopUpdateButton(state: DesktopUpdateState | null): boolean {
  if (!state || !state.enabled) {
    return false;
  }
  if (state.status === "downloading" || state.status === "installing") {
    return true;
  }
  return resolveDesktopUpdateButtonAction(state) !== "none";
}

export function shouldShowArm64IntelBuildWarning(state: DesktopUpdateState | null): boolean {
  return state?.hostArch === "arm64" && state.appArch === "x64";
}

export function isDesktopUpdateButtonDisabled(state: DesktopUpdateState | null): boolean {
  return state?.status === "downloading" || state?.status === "installing";
}

export function getArm64IntelBuildWarningDescription(state: DesktopUpdateState): string {
  if (!shouldShowArm64IntelBuildWarning(state)) {
    return "This install is using the correct architecture.";
  }

  const action = resolveDesktopUpdateButtonAction(state);
  if (action === "download") {
    return "This Mac has Apple Silicon, but Tabs is still running the Intel build under Rosetta. Download the available update to switch to the native Apple Silicon build.";
  }
  if (action === "install") {
    return "This Mac has Apple Silicon, but Tabs is still running the Intel build under Rosetta. Restart to install the downloaded Apple Silicon build.";
  }
  return "This Mac has Apple Silicon, but Tabs is still running the Intel build under Rosetta. The next app update will replace it with the native Apple Silicon build.";
}

export function getDesktopUpdateButtonTooltip(state: DesktopUpdateState): string {
  if (state.status === "available") {
    return `Update ${state.availableVersion ?? "available"} ready to download`;
  }
  if (state.status === "downloading") {
    const progress =
      typeof state.downloadPercent === "number" ? ` (${Math.floor(state.downloadPercent)}%)` : "";
    return `Downloading update${progress}`;
  }
  if (state.status === "downloaded") {
    return `Update ${state.downloadedVersion ?? state.availableVersion ?? "ready"} downloaded. Click to restart and install.`;
  }
  if (state.status === "installing") {
    return "Preparing to restart and install the update";
  }
  if (state.status === "error") {
    if (state.errorContext === "download" && state.availableVersion) {
      return `Download failed for ${state.availableVersion}. Click to retry.`;
    }
    if (state.errorContext === "install" && state.downloadedVersion) {
      return `Install failed for ${state.downloadedVersion}. Click to retry.`;
    }
    return state.message ?? "Update failed";
  }
  return "Update available";
}

export function getDesktopUpdateActionError(result: DesktopUpdateActionResult): string | null {
  if (!result.accepted || result.completed) return null;
  if (typeof result.state.message !== "string") return null;
  const message = result.state.message.trim();
  return message.length > 0 ? message : null;
}

export function shouldToastDesktopUpdateActionResult(result: DesktopUpdateActionResult): boolean {
  return result.accepted && !result.completed;
}

export function shouldHighlightDesktopUpdateError(state: DesktopUpdateState | null): boolean {
  if (!state || state.status !== "error") return false;
  return state.errorContext === "download" || state.errorContext === "install";
}
