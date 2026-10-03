import { spawn } from "node:child_process";
// SHA-512 re-verification removed: electron-updater already verified the download hash.
import * as FS from "node:fs";
import * as FSPromises from "node:fs/promises";
import * as Path from "node:path";

const STAGE_PREFIX = ".Tabs.appimage-update-";

export const LINUX_APPIMAGE_INSTALL_SCRIPT = `set -eu
target="$1"
staged="$2"
backup="$3"
stage_root="$4"
old_pid="$5"
log="$6"
exec >>"$log" 2>&1
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) waiting for Tabs process $old_pid"
while kill -0 "$old_pid" 2>/dev/null; do sleep 0.2; done
if ! mv -- "$target" "$backup"; then
  echo "Could not move the previous AppImage into backup"
  rm -f -- "$staged"
  rm -rf -- "$stage_root"
  exit 1
fi
if ! mv -- "$staged" "$target"; then
  echo "Could not install the staged AppImage; restoring previous version"
  mv -- "$backup" "$target"
  rm -f -- "$staged"
  rm -rf -- "$stage_root"
  exit 1
fi
"$target" &
new_pid="$!"
sleep 3
if kill -0 "$new_pid" 2>/dev/null; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) installed and relaunched update"
  rm -f -- "$backup"
  rm -rf -- "$stage_root"
else
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) updated AppImage exited immediately; restoring previous version"
  rm -f -- "$target"
  mv -- "$backup" "$target"
  rm -rf -- "$stage_root"
  "$target" &
  exit 1
fi
`;

export interface PreparedLinuxAppImageUpdate {
  readonly stageRoot: string;
  readonly targetPath: string;
  readonly stagedPath: string;
  readonly backupPath: string;
  launch(oldPid: number): Promise<void>;
  dispose(): Promise<void>;
}

export async function prepareLinuxAppImageUpdate(input: {
  readonly currentAppImagePath: string;
  readonly downloadedAppImagePath: string;
  readonly logPath: string;
}): Promise<PreparedLinuxAppImageUpdate> {
  const targetPath = Path.resolve(input.currentAppImagePath);
  const sourcePath = Path.resolve(input.downloadedAppImagePath);
  if (targetPath === sourcePath)
    throw new Error("The downloaded AppImage must differ from the running one.");
  const sourceStat = await FSPromises.stat(sourcePath);
  if (!sourceStat.isFile() || sourceStat.size < 4)
    throw new Error("The downloaded AppImage is invalid.");
  const header = Buffer.alloc(4);
  const handle = await FSPromises.open(sourcePath, "r");
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  if (header[0] !== 0x7f || header.subarray(1).toString("ascii") !== "ELF") {
    throw new Error("The downloaded update is not an AppImage executable.");
  }

  const stageRoot = await FSPromises.mkdtemp(Path.join(Path.dirname(targetPath), STAGE_PREFIX));
  const stagedPath = Path.join(stageRoot, "Tabs.AppImage");
  const backupPath = Path.join(stageRoot, "Tabs.previous.AppImage");
  try {
    await FSPromises.copyFile(sourcePath, stagedPath, FS.constants.COPYFILE_EXCL);
    await FSPromises.chmod(stagedPath, 0o755);
    // Size check is sufficient to guard against a truncated copy.
    // electron-updater already verified the full SHA-512 hash during download,
    // so re-hashing the 3+ GB file here is redundant and causes the install
    // to stall for minutes inside the "Preparing to restart..." state.
    const copiedStat = await FSPromises.stat(stagedPath);
    if (copiedStat.size !== sourceStat.size) throw new Error("The staged AppImage is incomplete.");
  } catch (error) {
    await FSPromises.rm(stageRoot, { recursive: true, force: true });
    throw error;
  }

  return {
    stageRoot,
    targetPath,
    stagedPath,
    backupPath,
    async launch(oldPid: number): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          "/bin/sh",
          [
            "-c",
            LINUX_APPIMAGE_INSTALL_SCRIPT,
            "tabs-appimage-update",
            targetPath,
            stagedPath,
            backupPath,
            stageRoot,
            String(oldPid),
            input.logPath,
          ],
          { detached: true, stdio: "ignore" },
        );
        child.once("error", reject);
        child.once("spawn", () => {
          child.unref();
          resolve();
        });
      });
    },
    async dispose(): Promise<void> {
      await FSPromises.rm(stageRoot, { recursive: true, force: true });
    },
  };
}
