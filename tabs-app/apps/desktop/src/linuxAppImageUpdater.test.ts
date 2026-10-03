import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { LINUX_APPIMAGE_INSTALL_SCRIPT, prepareLinuxAppImageUpdate } from "./linuxAppImageUpdater";

describe.skipIf(process.platform === "win32")("Linux AppImage install helper", () => {
  it("stages a verified executable next to the running AppImage", async () => {
    const root = mkdtempSync(join(tmpdir(), "tabs-appimage-stage-test-"));
    const current = join(root, "Tabs.AppImage");
    const downloaded = join(root, "download.AppImage");
    writeFileSync(current, "old");
    writeFileSync(downloaded, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1]));
    const prepared = await prepareLinuxAppImageUpdate({
      currentAppImagePath: current,
      downloadedAppImagePath: downloaded,
      logPath: join(root, "update.log"),
    });
    expect(existsSync(prepared.stagedPath)).toBe(true);
    expect(readFileSync(prepared.stagedPath)).toEqual(readFileSync(downloaded));
    await prepared.dispose();
    expect(existsSync(prepared.stageRoot)).toBe(false);
  });

  it("rejects a non-AppImage download before touching the current app", async () => {
    const root = mkdtempSync(join(tmpdir(), "tabs-appimage-stage-test-"));
    const current = join(root, "Tabs.AppImage");
    const downloaded = join(root, "download.AppImage");
    writeFileSync(current, "old");
    writeFileSync(downloaded, "not an ELF file");
    await expect(
      prepareLinuxAppImageUpdate({
        currentAppImagePath: current,
        downloadedAppImagePath: downloaded,
        logPath: join(root, "update.log"),
      }),
    ).rejects.toThrow("not an AppImage");
    expect(readFileSync(current, "utf8")).toBe("old");
  });

  it("replaces the AppImage and keeps a running new version", () => {
    const root = mkdtempSync(join(tmpdir(), "tabs-appimage-helper-test-"));
    const target = join(root, "Tabs.AppImage");
    const stage = join(root, "stage");
    const staged = join(stage, "new.AppImage");
    const backup = join(stage, "old.AppImage");
    spawnSync("mkdir", [stage]);
    writeFileSync(target, "old");
    writeFileSync(staged, "#!/bin/sh\nsleep 10\n", { mode: 0o755 });
    const result = spawnSync("/bin/sh", [
      "-c",
      LINUX_APPIMAGE_INSTALL_SCRIPT,
      "test",
      target,
      staged,
      backup,
      stage,
      "99999999",
      join(root, "update.log"),
    ]);
    expect(result.status).toBe(0);
    expect(readFileSync(target, "utf8")).toContain("sleep 10");
  });

  it("restores the previous AppImage when the new one exits immediately", () => {
    const root = mkdtempSync(join(tmpdir(), "tabs-appimage-helper-test-"));
    const target = join(root, "Tabs.AppImage");
    const stage = join(root, "stage");
    const staged = join(stage, "new.AppImage");
    const backup = join(stage, "old.AppImage");
    spawnSync("mkdir", [stage]);
    writeFileSync(target, "old");
    writeFileSync(staged, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const result = spawnSync("/bin/sh", [
      "-c",
      LINUX_APPIMAGE_INSTALL_SCRIPT,
      "test",
      target,
      staged,
      backup,
      stage,
      "99999999",
      join(root, "update.log"),
    ]);
    expect(result.status).toBe(1);
    expect(readFileSync(target, "utf8")).toBe("old");
  });
});
