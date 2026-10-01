import { generateKeyPairSync, sign } from "node:crypto";
import { execFile } from "node:child_process";
import * as FSPromises from "node:fs/promises";
import * as OS from "node:os";
import * as Path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";

import {
  compareMacPreviewVersions,
  createMacPreviewStageDirectory,
  MAC_PREVIEW_INSTALL_SCRIPT,
  parseAndVerifyMacPreviewManifest,
  reuseVerifiedMacPreviewStage,
} from "./macPreviewUpdater";

const execFileAsync = promisify(execFile);

function createSignedManifest(overrides: Record<string, unknown> = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const manifest = {
    schemaVersion: 1,
    version: "1.4.0",
    releaseDate: "2026-09-21T12:00:00.000Z",
    repository: "PanicMako/Tabs-ide",
    releaseNotes: "## What changed\n\n- Faster startup",
    assets: {
      arm64: {
        name: "Tabs-1.4.0-arm64.zip",
        sha512: Buffer.alloc(64, 1).toString("base64"),
        size: 123,
      },
      x64: {
        name: "Tabs-1.4.0-x64.zip",
        sha512: Buffer.alloc(64, 2).toString("base64"),
        size: 456,
      },
    },
    ...overrides,
  };
  const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  return {
    bytes,
    publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
    signature: sign(null, bytes, privateKey).toString("base64"),
  };
}

describe("parseAndVerifyMacPreviewManifest", () => {
  it("accepts a well-formed manifest signed by the expected key", () => {
    const fixture = createSignedManifest();
    const result = parseAndVerifyMacPreviewManifest(
      fixture.bytes,
      fixture.signature,
      "PanicMako/Tabs-ide",
      fixture.publicKey,
    );
    expect(result.version).toBe("1.4.0");
    expect(result.releaseNotes).toContain("Faster startup");
    expect(result.assets.arm64.name).toBe("Tabs-1.4.0-arm64.zip");
  });

  it("rejects tampered manifest bytes", () => {
    const fixture = createSignedManifest();
    const tampered = Buffer.from(fixture.bytes.toString().replace("1.4.0", "9.9.9"));
    expect(() =>
      parseAndVerifyMacPreviewManifest(
        tampered,
        fixture.signature,
        "PanicMako/Tabs-ide",
        fixture.publicKey,
      ),
    ).toThrow("signature is invalid");
  });

  it("rejects a valid signature for another repository", () => {
    const fixture = createSignedManifest({ repository: "attacker/Tabs-ide" });
    expect(() =>
      parseAndVerifyMacPreviewManifest(
        fixture.bytes,
        fixture.signature,
        "PanicMako/Tabs-ide",
        fixture.publicKey,
      ),
    ).toThrow("targets another project");
  });
});

describe("compareMacPreviewVersions", () => {
  it("orders stable and prerelease versions", () => {
    expect(compareMacPreviewVersions("1.4.0", "1.3.12")).toBeGreaterThan(0);
    expect(compareMacPreviewVersions("1.4.0", "1.4.0-beta.2")).toBeGreaterThan(0);
    expect(compareMacPreviewVersions("1.4.0-beta.10", "1.4.0-beta.2")).toBeGreaterThan(0);
    expect(compareMacPreviewVersions("1.4.0", "1.4.0")).toBe(0);
  });
});

describe("createMacPreviewStageDirectory", () => {
  it("cleans stale staging and creates a unique directory for each attempt", async () => {
    const installDirectory = await FSPromises.mkdtemp(
      Path.join(OS.tmpdir(), "tabs-mac-preview-stage-test-"),
    );
    try {
      const stale = Path.join(installDirectory, ".Tabs.preview-update-1.3.14");
      await FSPromises.mkdir(Path.join(stale, "Tabs.app", "Contents", "Resources"), {
        recursive: true,
      });
      await FSPromises.writeFile(
        Path.join(stale, "Tabs.app", "Contents", "Resources", "app.asar"),
        "stale",
      );
      const backup = Path.join(installDirectory, "Tabs.app.preview-update-backup-123");
      await FSPromises.mkdir(backup);
      await FSPromises.writeFile(Path.join(backup, "version"), "recoverable");

      const first = await createMacPreviewStageDirectory(installDirectory, "1.3.15");
      const second = await createMacPreviewStageDirectory(installDirectory, "1.3.15");

      await expect(FSPromises.stat(stale)).rejects.toMatchObject({ code: "ENOENT" });
      expect(first).not.toBe(second);
      expect(Path.basename(second)).toMatch(/^\.Tabs\.preview-update-1\.3\.15-/);
      expect(await FSPromises.readFile(Path.join(backup, "version"), "utf8")).toBe("recoverable");
    } finally {
      await FSPromises.rm(installDirectory, { recursive: true, force: true });
    }
  });
});

describe("reuseVerifiedMacPreviewStage", () => {
  it("reuses a staged app only after it is revalidated", async () => {
    const validate = vi.fn(async () => undefined);
    await expect(reuseVerifiedMacPreviewStage("/tmp/Tabs.app", "1.3.15", validate)).resolves.toBe(
      "/tmp/Tabs.app",
    );
    expect(validate).toHaveBeenCalledWith("/tmp/Tabs.app", "1.3.15");
  });

  it("rejects an invalid staged app", async () => {
    const validate = vi.fn(async () => {
      throw new Error("invalid signature");
    });
    await expect(
      reuseVerifiedMacPreviewStage("/tmp/Tabs.app", "1.3.15", validate),
    ).resolves.toBeNull();
  });
});

describe("MAC_PREVIEW_INSTALL_SCRIPT", () => {
  const shellIt = process.platform === "win32" ? it.skip : it;

  shellIt("atomically replaces the app and removes its backup after relaunch", async () => {
    const installDirectory = await FSPromises.mkdtemp(
      Path.join(OS.tmpdir(), "tabs-mac-preview-install-test-"),
    );
    try {
      const target = Path.join(installDirectory, "Tabs.app");
      const stageRoot = Path.join(installDirectory, ".Tabs.preview-update-1.3.15-test");
      const staged = Path.join(stageRoot, "Tabs.app");
      const backup = `${target}.preview-update-backup-test`;
      const log = Path.join(installDirectory, "install.log");
      await FSPromises.mkdir(target);
      await FSPromises.writeFile(Path.join(target, "version"), "old");
      await FSPromises.mkdir(staged, { recursive: true });
      await FSPromises.writeFile(Path.join(staged, "version"), "new");

      await execFileAsync("/bin/sh", [
        "-c",
        MAC_PREVIEW_INSTALL_SCRIPT,
        "tabs-preview-updater",
        target,
        staged,
        backup,
        "99999999",
        stageRoot,
        log,
        "/usr/bin/true",
      ]);

      expect(await FSPromises.readFile(Path.join(target, "version"), "utf8")).toBe("new");
      await expect(FSPromises.stat(backup)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await FSPromises.readFile(log, "utf8")).toContain("installed and relaunched");
    } finally {
      await FSPromises.rm(installDirectory, { recursive: true, force: true });
    }
  });

  shellIt("restores the previous app when relaunch is refused", async () => {
    const installDirectory = await FSPromises.mkdtemp(
      Path.join(OS.tmpdir(), "tabs-mac-preview-rollback-test-"),
    );
    try {
      const target = Path.join(installDirectory, "Tabs.app");
      const stageRoot = Path.join(installDirectory, ".Tabs.preview-update-1.3.15-test");
      const staged = Path.join(stageRoot, "Tabs.app");
      const backup = `${target}.preview-update-backup-test`;
      const log = Path.join(installDirectory, "install.log");
      await FSPromises.mkdir(target);
      await FSPromises.writeFile(Path.join(target, "version"), "old");
      await FSPromises.mkdir(staged, { recursive: true });
      await FSPromises.writeFile(Path.join(staged, "version"), "new");

      await expect(
        execFileAsync("/bin/sh", [
          "-c",
          MAC_PREVIEW_INSTALL_SCRIPT,
          "tabs-preview-updater",
          target,
          staged,
          backup,
          "99999999",
          stageRoot,
          log,
          "/usr/bin/false",
        ]),
      ).rejects.toBeDefined();

      expect(await FSPromises.readFile(Path.join(target, "version"), "utf8")).toBe("old");
      expect(await FSPromises.readFile(log, "utf8")).toContain("restoring previous app");
    } finally {
      await FSPromises.rm(installDirectory, { recursive: true, force: true });
    }
  });
});
