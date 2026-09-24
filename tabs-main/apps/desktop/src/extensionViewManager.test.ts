import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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
});
