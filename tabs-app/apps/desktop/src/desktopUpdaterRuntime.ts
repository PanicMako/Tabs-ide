import * as FS from "node:fs";
import * as Path from "node:path";

interface NativeUpdaterDownload<T> {
  readonly isDifferentialDownloadDisabled: () => boolean;
  readonly setDifferentialDownloadDisabled: (disabled: boolean) => void;
  readonly download: () => Promise<T>;
  readonly log: (message: string) => void;
}

/** Retry a rejected differential update once as a full download. */
export async function downloadNativeUpdateWithFallback<T>(
  updater: NativeUpdaterDownload<T>,
): Promise<T> {
  const startedWithDifferentialDownload = !updater.isDifferentialDownloadDisabled();
  try {
    return await updater.download();
  } catch (error) {
    if (!startedWithDifferentialDownload) throw error;
    updater.setDifferentialDownloadDisabled(true);
    updater.log("Differential download failed; retrying the update as a full download.");
    return await updater.download();
  }
}

export interface UpdateInstallEnvironment {
  readonly platform: NodeJS.Platform;
  readonly appImagePath?: string | undefined;
  readonly accessSync?: typeof FS.accessSync;
}

/** Validate conditions which electron-updater otherwise reports only during installation. */
export function assertUpdateInstallEnvironment(environment: UpdateInstallEnvironment): void {
  if (environment.platform !== "linux") return;
  const appImagePath = environment.appImagePath?.trim();
  if (!appImagePath) throw new Error("Linux updates require running Tabs from an AppImage.");

  const accessSync = environment.accessSync ?? FS.accessSync;
  try {
    accessSync(appImagePath, FS.constants.R_OK | FS.constants.W_OK);
    accessSync(Path.dirname(appImagePath), FS.constants.W_OK);
  } catch {
    throw new Error(
      `The AppImage and its folder must be writable before Tabs can install an update: ${appImagePath}`,
    );
  }
}

/** Keep the running app open if the cached Windows installer disappeared or is invalid. */
export function assertWindowsInstallerReady(
  installerPath: string | null,
  fileSystem: Pick<typeof FS, "statSync" | "openSync" | "readSync" | "closeSync"> = FS,
): void {
  if (!installerPath)
    throw new Error("The downloaded Windows installer is unavailable; download the update again.");
  try {
    if (!fileSystem.statSync(installerPath).isFile()) throw new Error("Not a regular file");
    const fd = fileSystem.openSync(installerPath, "r");
    try {
      const header = Buffer.alloc(2);
      if (
        fileSystem.readSync(fd, header, 0, header.length, 0) !== 2 ||
        header.toString("ascii") !== "MZ"
      ) {
        throw new Error("Not a Windows executable");
      }
    } finally {
      fileSystem.closeSync(fd);
    }
  } catch {
    throw new Error(
      "The downloaded Windows installer is missing or invalid; download the update again.",
    );
  }
}

interface NativeUpdaterInstall {
  readonly quitAndInstall: (isSilent: boolean, isForceRunAfter: boolean) => void;
}

/** Ask the native installer to relaunch Tabs after applying the update. */
export function requestNativeUpdateInstall(updater: NativeUpdaterInstall): void {
  updater.quitAndInstall(true, true);
}

/** The installer must not race against session flushes or the old process lock. */
export function handOffNativeUpdateAfterCleanup(input: {
  readonly releaseSingleInstanceLock: () => void;
  readonly updater: NativeUpdaterInstall;
  readonly quit: () => void;
}): void {
  input.releaseSingleInstanceLock();
  try {
    requestNativeUpdateInstall(input.updater);
  } finally {
    input.quit();
  }
}
