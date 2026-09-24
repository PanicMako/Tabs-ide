import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { packTabsext } from "@tabs/extension-package";

vi.mock("electron", () => ({
  session: { fromPartition: vi.fn() },
  WebContentsView: vi.fn(),
}));

import { ExtensionViewManager } from "./extensionViewManager";

const temporaryRoots: string[] = [];

function fixture(): { directory: string; manager: ExtensionViewManager } {
  const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-extension-test-"));
  temporaryRoots.push(directory);
  FS.mkdirSync(Path.join(directory, "dist"));
  FS.writeFileSync(
    Path.join(directory, "dist", "index.html"),
    "<!doctype html><title>Test</title>",
  );
  FS.writeFileSync(
    Path.join(directory, "tabs-extension.json"),
    JSON.stringify({
      manifestVersion: 1,
      publisher: "acme",
      name: "dashboard",
      version: "1.0.0",
      displayName: "Dashboard",
      description: "Test dashboard",
      engines: { tabs: ">=1.3.0 <2.0.0" },
      contributes: { tools: [{ id: "main", label: "Main", entry: "dist/index.html" }] },
    }),
  );
  const manager = new ExtensionViewManager(
    () => null,
    {} as ConstructorParameters<typeof ExtensionViewManager>[1],
    Path.join(directory, "installed.json"),
    "1.3.17",
    true,
  );
  return { directory, manager };
}

afterEach(() => {
  for (const directory of temporaryRoots.splice(0))
    FS.rmSync(directory, { recursive: true, force: true });
});

describe("development extension installation", () => {
  it("binds storage to the active view and a project grant", () => {
    const { directory, manager } = fixture();
    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.capabilities = ["profile-storage"];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const installed = manager.installDevelopment(directory);
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
      storageGrantedProjectIds: ["project-a"],
    });
    const sender = { isDestroyed: () => false };
    const internal = manager as unknown as {
      active: {
        key: string;
        view: { webContents: typeof sender };
        extensionId: string;
        projectId: string;
        profileId: string;
      } | null;
    };
    internal.active = {
      key: "active",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-a",
      profileId: "default",
    };
    expect(() =>
      manager.invokeStorage({ isDestroyed: () => false } as never, {
        kind: "get",
        key: "theme",
      }),
    ).toThrow(/no longer active/);
    manager.invokeStorage(sender as never, { kind: "set", key: "theme", value: "dark" });
    expect(manager.invokeStorage(sender as never, { kind: "get", key: "theme" })).toBe("dark");
    internal.active = null;
    manager.setAssignment(installed.id, {
      ...manager.list()[0]!.assignment,
      storageGrantedProjectIds: [],
    });
    internal.active = {
      key: "stale",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-a",
      profileId: "default",
    };
    expect(() => manager.invokeStorage(sender as never, { kind: "get", key: "theme" })).toThrow(
      /not granted/,
    );
  });

  it("clears stale storage grants when an update first requests storage", () => {
    const { directory, manager } = fixture();
    const first = manager.installDevelopment(directory);
    manager.setAssignment(first.id, {
      ...first.assignment,
      storageGrantedProjectIds: ["project-a"],
    });
    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.version = "1.0.1";
    manifest.capabilities = ["profile-storage"];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(manager.installDevelopment(directory).assignment.storageGrantedProjectIds).toEqual([]);
  });

  it("installs a manifest once and preserves project assignments", () => {
    const { directory, manager } = fixture();
    const installed = manager.installDevelopment(directory);
    expect(installed.id).toBe("acme.dashboard");
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
    });
    expect(manager.list()[0]?.assignment.enabledProjectIds).toEqual(["project-a"]);
    manager.addProfile(installed.id, "personal", "Personal");
    expect(manager.list()[0]?.profiles.map((profile) => profile.id)).toEqual([
      "default",
      "personal",
    ]);
  });

  it("rejects symlinked package assets", () => {
    const { directory, manager } = fixture();
    FS.symlinkSync(
      Path.join(directory, "dist", "index.html"),
      Path.join(directory, "dist", "linked.html"),
    );
    expect(() => manager.installDevelopment(directory)).toThrow(/regular files/);
  });

  it("rejects unsupported manifest execution fields", () => {
    const { directory, manager } = fixture();
    const path = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(path, "utf8"));
    manifest.runtime = { entry: "dist/index.js" };
    FS.writeFileSync(path, JSON.stringify(manifest));
    expect(() => manager.installDevelopment(directory)).toThrow(/Unsupported manifest field/);
  });

  it("does not load development folders in a packaged build", () => {
    const { directory, manager } = fixture();
    manager.installDevelopment(directory);
    const packaged = new ExtensionViewManager(
      () => null,
      {} as ConstructorParameters<typeof ExtensionViewManager>[1],
      Path.join(directory, "installed.json"),
      "1.3.17",
      false,
    );
    expect(packaged.list()).toEqual([]);
    expect(() => packaged.installDevelopment(directory)).toThrow(/disabled/);
  });

  it("imports a local package once and preserves assignments across replacement", async () => {
    const { directory, manager } = fixture();
    const archiveRoot = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-extension-archive-test-"));
    temporaryRoots.push(archiveRoot);
    const firstArchive = Path.join(archiveRoot, "first.tabsext");
    await packTabsext({ directory, destination: firstArchive, tabsVersion: "1.3.17" });
    const first = await manager.installLocalPackage(firstArchive);
    expect(first.source).toBe("local-package");
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
    manager.setAssignment(first.id, { ...first.assignment, enabledProjectIds: ["project-a"] });
    manager.addProfile(first.id, "work", "Work");
    expect(await manager.installLocalPackage(firstArchive)).toEqual(manager.list()[0]);

    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.version = "1.0.1";
    const updatedSource = Path.join(archiveRoot, "updated-source");
    FS.mkdirSync(Path.join(updatedSource, "dist"), { recursive: true });
    FS.copyFileSync(
      Path.join(directory, "dist", "index.html"),
      Path.join(updatedSource, "dist", "index.html"),
    );
    FS.writeFileSync(Path.join(updatedSource, "tabs-extension.json"), JSON.stringify(manifest));
    const secondArchive = Path.join(archiveRoot, "second.tabsext");
    await packTabsext({
      directory: updatedSource,
      destination: secondArchive,
      tabsVersion: "1.3.17",
    });
    const updated = await manager.installLocalPackage(secondArchive);
    expect(updated.manifest.version).toBe("1.0.1");
    expect(updated.assignment.enabledProjectIds).toEqual(["project-a"]);
    expect(updated.profiles.map((profile) => profile.id)).toEqual(["default", "work"]);
    expect(updated.digest).not.toBe(first.digest);

    const restarted = new ExtensionViewManager(
      () => null,
      {} as ConstructorParameters<typeof ExtensionViewManager>[1],
      Path.join(directory, "installed.json"),
      "1.3.17",
      true,
    );
    expect(restarted.list()).toEqual([updated]);
  });

  it("keeps local packages unavailable in production builds", async () => {
    const { directory } = fixture();
    const packaged = new ExtensionViewManager(
      () => null,
      {} as ConstructorParameters<typeof ExtensionViewManager>[1],
      Path.join(directory, "installed.json"),
      "1.3.17",
      false,
    );
    await expect(packaged.installLocalPackage("/tmp/example.tabsext")).rejects.toThrow(/disabled/);
  });
});
