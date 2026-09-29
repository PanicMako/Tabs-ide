import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetTabsUserData } from "./userDataReset";

const tempDirectories: string[] = [];

function createTempDirectory(): string {
  const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-user-data-reset-"));
  tempDirectories.push(directory);
  return directory;
}

function writeFile(root: string, relativePath: string, contents = "test-data"): void {
  const filePath = Path.join(root, relativePath);
  FS.mkdirSync(Path.dirname(filePath), { recursive: true });
  FS.writeFileSync(filePath, contents);
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    FS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("resetTabsUserData", () => {
  it("clears Tabs records and profiles while retaining editor and project files", () => {
    const tempDir = createTempDirectory();
    const baseDir = Path.join(tempDir, ".tabs");
    const homeDir = Path.join(tempDir, "home");
    const stateDir = Path.join(baseDir, "userdata");
    const profiles = [
      Path.join(baseDir, "config", "tabs"),
      Path.join(baseDir, "config", "Tabs (Alpha)"),
      Path.join(baseDir, "config", "Tabs"),
    ];

    writeFile(stateDir, "state.sqlite");
    writeFile(stateDir, "settings.json");
    writeFile(stateDir, "attachments/attachment.txt");
    writeFile(stateDir, "code-oss-main/User/settings.json");
    writeFile(stateDir, "code-oss-desktop/extensions/example/package.json");
    writeFile(stateDir, "workspace-tabs-project_1.json");
    writeFile(baseDir, "code-oss-runtime/bin/code");
    writeFile(baseDir, "worktrees/project/README.md");
    writeFile(profiles[0]!, "Local Storage/leveldb/000001.log");
    writeFile(profiles[1]!, "Cookies");
    writeFile(profiles[2]!, "connection-catalog.json");
    writeFile(baseDir, "dev/review_state/review.json");
    writeFile(baseDir, "dev/review_history/history.json");
    writeFile(baseDir, "dev/feedback_store.json");
    writeFile(baseDir, "dev/state.sqlite");
    writeFile(baseDir, "dev/desktop-theme.json");
    writeFile(baseDir, "dev/other-dev-data.json");

    resetTabsUserData({ baseDir, stateDir, electronProfileDirs: profiles, homeDir });

    expect(FS.readdirSync(stateDir).sort()).toEqual([
      "code-oss-desktop",
      "code-oss-main",
      "workspace-tabs-project_1.json",
    ]);
    expect(FS.existsSync(Path.join(stateDir, "code-oss-main/User/settings.json"))).toBe(true);
    expect(
      FS.existsSync(Path.join(stateDir, "code-oss-desktop/extensions/example/package.json")),
    ).toBe(true);
    expect(FS.existsSync(Path.join(stateDir, "workspace-tabs-project_1.json"))).toBe(true);
    expect(FS.existsSync(Path.join(baseDir, "code-oss-runtime/bin/code"))).toBe(true);
    expect(FS.existsSync(Path.join(baseDir, "worktrees/project/README.md"))).toBe(true);
    for (const profile of profiles) expect(FS.readdirSync(profile)).toEqual([]);

    expect(FS.existsSync(Path.join(baseDir, "dev/review_state/review.json"))).toBe(true);
    expect(FS.existsSync(Path.join(baseDir, "dev/review_history/history.json"))).toBe(true);
    expect(FS.existsSync(Path.join(baseDir, "dev/feedback_store.json"))).toBe(true);
    expect(FS.existsSync(Path.join(baseDir, "dev/state.sqlite"))).toBe(true);
    expect(FS.existsSync(Path.join(baseDir, "dev/desktop-theme.json"))).toBe(true);
    expect(FS.existsSync(Path.join(baseDir, "dev/other-dev-data.json"))).toBe(true);
  });

  it("validates all profile paths before clearing any data", () => {
    const baseDir = createTempDirectory();
    const stateDir = Path.join(baseDir, "userdata");
    const overlappingProfile = Path.join(stateDir, "code-oss-main");
    writeFile(stateDir, "settings.json");
    writeFile(overlappingProfile, "User/settings.json");

    expect(() =>
      resetTabsUserData({
        baseDir,
        stateDir,
        electronProfileDirs: [overlappingProfile],
        homeDir: Path.join(baseDir, "home"),
      }),
    ).toThrow(/overlaps the Tabs state directory/);
    expect(FS.existsSync(Path.join(stateDir, "settings.json"))).toBe(true);
    expect(FS.existsSync(Path.join(overlappingProfile, "User/settings.json"))).toBe(true);
  });

  it("refuses state directories that resolve outside the Tabs data root", () => {
    const tempDir = createTempDirectory();
    const baseDir = Path.join(tempDir, ".tabs");
    const stateDir = Path.join(baseDir, "userdata");
    const externalProjectDir = Path.join(tempDir, "project");
    writeFile(externalProjectDir, "src/main.ts");
    FS.mkdirSync(baseDir, { recursive: true });
    FS.symlinkSync(externalProjectDir, stateDir, "dir");

    expect(() =>
      resetTabsUserData({
        baseDir,
        stateDir,
        electronProfileDirs: [],
        homeDir: Path.join(tempDir, "home"),
      }),
    ).toThrow(/state directory must stay inside the Tabs data root/);
    expect(FS.existsSync(Path.join(externalProjectDir, "src/main.ts"))).toBe(true);
  });

  it("clears the active development server store and keeps the embedded editor state", () => {
    const homeDir = createTempDirectory();
    const baseDir = Path.join(homeDir, ".tabs");
    const stateDir = Path.join(baseDir, "userdata");
    const developmentStateDir = Path.join(baseDir, "dev");
    const profileDir = Path.join(homeDir, ".config", "tabs-dev");

    writeFile(stateDir, "code-oss-main/User/settings.json");
    writeFile(developmentStateDir, "state.sqlite");
    writeFile(developmentStateDir, "settings.json");
    writeFile(developmentStateDir, "review_state/review.json");
    writeFile(profileDir, "Local Storage/leveldb/000001.log");

    resetTabsUserData({
      baseDir,
      stateDir,
      additionalStateDirs: [developmentStateDir],
      electronProfileDirs: [profileDir],
      homeDir,
    });

    expect(FS.readdirSync(developmentStateDir)).toEqual([]);
    expect(FS.existsSync(Path.join(stateDir, "code-oss-main/User/settings.json"))).toBe(true);
    expect(FS.readdirSync(profileDir)).toEqual([]);
  });

  it("clears development desktop state without clearing production state", () => {
    const homeDir = createTempDirectory();
    const baseDir = Path.join(homeDir, ".tabs");
    const stateDir = Path.join(baseDir, "dev");
    const productionStateDir = Path.join(baseDir, "userdata");
    const developmentProfile = Path.join(homeDir, ".config", "tabs-dev");
    const productionProfile = Path.join(homeDir, ".config", "tabs");

    writeFile(stateDir, "state.sqlite");
    writeFile(stateDir, "desktop-theme.json");
    writeFile(stateDir, "review_state/review.json");
    writeFile(productionStateDir, "state.sqlite");
    writeFile(productionStateDir, "desktop-theme.json");
    writeFile(developmentProfile, "Local Storage/leveldb/000001.log");
    writeFile(productionProfile, "Local Storage/leveldb/000001.log");

    resetTabsUserData({
      baseDir,
      stateDir,
      electronProfileDirs: [developmentProfile],
      homeDir,
    });

    expect(FS.readdirSync(stateDir)).toEqual([]);
    expect(FS.existsSync(Path.join(productionStateDir, "state.sqlite"))).toBe(true);
    expect(FS.existsSync(Path.join(productionStateDir, "desktop-theme.json"))).toBe(true);
    expect(FS.readdirSync(developmentProfile)).toEqual([]);
    expect(FS.existsSync(Path.join(productionProfile, "Local Storage/leveldb/000001.log"))).toBe(
      true,
    );
  });

  it("does not follow child symlinks while clearing a profile", () => {
    const baseDir = createTempDirectory();
    const stateDir = Path.join(baseDir, "userdata");
    const profileDir = Path.join(baseDir, "profile");
    const externalDir = Path.join(baseDir, "external");
    FS.mkdirSync(profileDir, { recursive: true });
    writeFile(externalDir, "keep.txt");
    FS.symlinkSync(externalDir, Path.join(profileDir, "linked-profile"), "dir");

    resetTabsUserData({
      baseDir,
      stateDir,
      electronProfileDirs: [profileDir],
      homeDir: Path.join(baseDir, "home"),
    });

    expect(FS.readdirSync(profileDir)).toEqual([]);
    expect(FS.readFileSync(Path.join(externalDir, "keep.txt"), "utf8")).toBe("test-data");
  });
});
