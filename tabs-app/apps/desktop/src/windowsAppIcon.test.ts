import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { ShortcutDetails } from "electron";
import {
  diskIconPath,
  isOwnedShortcut,
  updateWindowsIconShortcuts,
  windowsIconDetails,
} from "./windowsAppIcon";
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) FS.rmSync(folder, { recursive: true, force: true });
});
it("resolves Windows icon resources to physical unpacked files", () => {
  const path = String.raw`C:\Program Files\Tabs\resources\app.asar\apps\desktop\prod-resources\brand\icon-mono.ico`;
  const physical = path.replace("app.asar", "app.asar.unpacked");
  expect(diskIconPath(path, (candidate) => candidate === physical)).toBe(physical);
  expect(diskIconPath(path, () => false)).toBeNull();
  expect(diskIconPath("/dev/resources/icon.ico", () => true)).toBe("/dev/resources/icon.ico");
  expect(
    diskIconPath(
      "/app/app.asar/brand/icon.ico",
      (value) => value === "/app/app.asar.unpacked/brand/icon.ico",
    ),
  ).toBe("/app/app.asar.unpacked/brand/icon.ico");
});
it("sets the existing app identity and a taskbar icon, without changing relaunch arguments", () => {
  expect(windowsIconDetails("com.tabs.app", "C:\\Tabs\\brand\\icon.ico")).toEqual({
    appId: "com.tabs.app",
    appIconPath: "C:\\Tabs\\brand\\icon.ico",
    appIconIndex: 0,
  });
  expect(
    isOwnedShortcut(
      { target: "C:\\Tabs\\Tabs.exe", appUserModelId: "com.tabs.app" },
      "c:\\tabs\\tabs.exe",
      "com.tabs.app",
    ),
  ).toBe(true);
  expect(
    isOwnedShortcut(
      { target: "C:\\Other\\Tabs.exe", appUserModelId: "com.tabs.app" },
      "C:\\Tabs\\Tabs.exe",
      "com.tabs.app",
    ),
  ).toBe(false);
  expect(
    isOwnedShortcut(
      { target: "C:\\Tabs\\Tabs.exe", appUserModelId: "com.tabs.app.dev" },
      "C:\\Tabs\\Tabs.exe",
      "com.tabs.app",
    ),
  ).toBe(false);
});
it("updates only this installation's shortcuts and preserves their launch configuration", () => {
  const folder = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-icons-"));
  folders.push(folder);
  for (const name of ["Tabs.lnk", "Other.lnk", "Stale.lnk", "note.txt"])
    FS.writeFileSync(Path.join(folder, name), "fixture");
  const details = {
    target: "C:\\Tabs\\Tabs.exe",
    appUserModelId: "com.tabs.app",
    args: "--profile work",
    cwd: "C:\\Work",
    icon: "old.ico",
    iconIndex: 0,
  } as ShortcutDetails;
  const write = vi.fn(() => true);
  updateWindowsIconShortcuts({
    roots: [folder, folder],
    executable: details.target,
    appId: details.appUserModelId!,
    icon: "new.ico",
    read: (path) => {
      if (path.endsWith("Stale.lnk")) throw new Error("stale");
      return path.endsWith("Other.lnk") ? { ...details, target: "C:\\Other\\Tabs.exe" } : details;
    },
    write,
    report: vi.fn(),
  });
  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledWith(Path.join(folder, "Tabs.lnk"), "update", {
    ...details,
    icon: "new.ico",
    iconIndex: 0,
  });
});
it("the installer unpacks the logo variants that native Windows APIs load", () => {
  const build = FS.readFileSync(
    new URL("../../../scripts/build-desktop-artifact.ts", import.meta.url),
    "utf8",
  );
  expect(build).toContain('"apps/desktop/prod-resources/brand/**"');
  expect(build).toContain('"apps/desktop/prod-resources/*.ico"');
});
