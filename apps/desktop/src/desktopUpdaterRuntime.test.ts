import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  assertUpdateInstallEnvironment,
  assertWindowsInstallerReady,
  downloadNativeUpdateWithFallback,
  handOffNativeUpdateAfterCleanup,
  requestNativeUpdateInstall,
} from "./desktopUpdaterRuntime";

describe("downloadNativeUpdateWithFallback", () => {
  it("retries a failed differential download once as a full download", async () => {
    let disabled = false;
    const download = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("differential package unavailable"))
      .mockResolvedValueOnce();
    const log = vi.fn();
    await downloadNativeUpdateWithFallback({
      isDifferentialDownloadDisabled: () => disabled,
      setDifferentialDownloadDisabled: (value) => {
        disabled = value;
      },
      download,
      log,
    });
    expect(download).toHaveBeenCalledTimes(2);
    expect(disabled).toBe(true);
    expect(log).toHaveBeenCalledOnce();
  });

  it("does not retry when the full download was already selected", async () => {
    const error = new Error("network unavailable");
    const download = vi.fn<() => Promise<void>>().mockRejectedValue(error);
    await expect(
      downloadNativeUpdateWithFallback({
        isDifferentialDownloadDisabled: () => true,
        setDifferentialDownloadDisabled: vi.fn(),
        download,
        log: vi.fn(),
      }),
    ).rejects.toBe(error);
    expect(download).toHaveBeenCalledOnce();
  });
});

describe("assertUpdateInstallEnvironment", () => {
  it("requires a writable AppImage and parent folder on Linux", () => {
    const accessSync = vi.fn();
    assertUpdateInstallEnvironment({
      platform: "linux",
      appImagePath: "/opt/Tabs.AppImage",
      accessSync,
    });
    expect(accessSync).toHaveBeenNthCalledWith(
      1,
      "/opt/Tabs.AppImage",
      FS.constants.R_OK | FS.constants.W_OK,
    );
    expect(accessSync).toHaveBeenNthCalledWith(2, "/opt", FS.constants.W_OK);
  });

  it("reports an actionable error for an unwritable AppImage", () => {
    expect(() =>
      assertUpdateInstallEnvironment({
        platform: "linux",
        appImagePath: "/read-only/Tabs.AppImage",
        accessSync: () => {
          throw new Error("EACCES");
        },
      }),
    ).toThrow("AppImage and its folder must be writable");
  });

  it("does not apply AppImage checks to Windows or macOS", () => {
    const accessSync = vi.fn();
    assertUpdateInstallEnvironment({ platform: "win32", accessSync });
    assertUpdateInstallEnvironment({ platform: "darwin", accessSync });
    expect(accessSync).not.toHaveBeenCalled();
  });
});

describe("assertWindowsInstallerReady", () => {
  it("accepts an existing PE installer", () => {
    const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-win-installer-test-"));
    const path = Path.join(root, "Tabs.exe");
    FS.writeFileSync(path, "MZinstaller");
    expect(() => assertWindowsInstallerReady(path)).not.toThrow();
  });

  it("keeps the app open if the cached installer vanished", () => {
    expect(() => assertWindowsInstallerReady(null)).toThrow("unavailable");
    expect(() => assertWindowsInstallerReady("/missing/Tabs.exe")).toThrow("missing or invalid");
  });

  it("rejects a corrupt installer before shutdown", () => {
    const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-win-installer-test-"));
    const path = Path.join(root, "Tabs.exe");
    FS.writeFileSync(path, "bad");
    expect(() => assertWindowsInstallerReady(path)).toThrow("missing or invalid");
  });
});

describe("requestNativeUpdateInstall", () => {
  it("forces the native updater to relaunch Tabs after installation", () => {
    const quitAndInstall = vi.fn();
    requestNativeUpdateInstall({ quitAndInstall });
    expect(quitAndInstall).toHaveBeenCalledWith(true, true);
  });
});

describe("handOffNativeUpdateAfterCleanup", () => {
  it("releases the old lock before launching the installer, then quits", () => {
    const calls: string[] = [];
    handOffNativeUpdateAfterCleanup({
      releaseSingleInstanceLock: () => calls.push("release-lock"),
      updater: { quitAndInstall: () => calls.push("installer") },
      quit: () => calls.push("quit"),
    });
    expect(calls).toEqual(["release-lock", "installer", "quit"]);
  });

  it("still quits when the installer handoff throws after cleanup", () => {
    const quit = vi.fn();
    expect(() =>
      handOffNativeUpdateAfterCleanup({
        releaseSingleInstanceLock: vi.fn(),
        updater: {
          quitAndInstall: () => {
            throw new Error("installer failed");
          },
        },
        quit,
      }),
    ).toThrow("installer failed");
    expect(quit).toHaveBeenCalledOnce();
  });
});
