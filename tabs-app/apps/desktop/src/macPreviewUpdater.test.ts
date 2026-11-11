import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { execFile } from "node:child_process";
import * as FSPromises from "node:fs/promises";
import * as OS from "node:os";
import * as Path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";

import {
  MacPreviewUpdater,
  compareMacPreviewVersions,
  selectMacPreviewRelease,
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

describe("public macOS update release selection", () => {
  const release = (tag: string, prerelease = false) => ({
    tag_name: tag,
    prerelease,
    draft: false,
    assets: [
      "tabs-mac-preview-update.json",
      "tabs-mac-preview-update.json.sig",
      `Tabs-${tag.slice(1)}-arm64.zip`,
      `Tabs-${tag.slice(1)}-x64.zip`,
    ].map((name) => ({ name })),
  });
  it("selects beta for beta installs, while stable installs stay stable", () => {
    const stable = release("v1.3.30");
    const beta = release("v1.3.31-beta.2", true);
    expect(selectMacPreviewRelease([beta, stable], "1.3.31-beta.1")).toBe(beta.tag_name);
    expect(selectMacPreviewRelease([beta, stable], "1.3.30")).toBe(stable.tag_name);
  });
  it("rejects drafts, internal prereleases, incomplete assets and empty feeds", () => {
    expect(
      selectMacPreviewRelease(
        [
          release("v9.0.0-internal.1", true),
          { ...release("v2.0.0-beta.1", true), draft: true },
          { ...release("v3.0.0-beta.1", true), assets: [] },
        ],
        "1.3.31-beta.1",
      ),
    ).toBeNull();
    expect(selectMacPreviewRelease([], "1.3.31-beta.1")).toBeNull();
  });
  it("lets beta installs move to a newer stable version", () => {
    expect(
      selectMacPreviewRelease(
        [release("v1.3.31-beta.2", true), release("v1.3.31")],
        "1.3.31-beta.1",
      ),
    ).toBe("v1.3.31");
  });
});

it("uses explicit beta channel for plain prerelease versions", () => {
  const tag = "v1.3.31";
  const release = {
    tag_name: tag,
    prerelease: true,
    assets: [
      "tabs-mac-preview-update.json",
      "tabs-mac-preview-update.json.sig",
      "Tabs-1.3.31-arm64.zip",
      "Tabs-1.3.31-x64.zip",
    ].map((name) => ({ name })),
  };
  expect(selectMacPreviewRelease([release], "1.3.30", "beta")).toBe(tag);
  expect(selectMacPreviewRelease([release], "1.3.30", "stable")).toBeNull();
});

describe("MacPreviewUpdater archive integration", () => {
  async function setup(archive: Buffer) {
    const directory = await FSPromises.mkdtemp(Path.join(OS.tmpdir(), "tabs-updater-integration-"));
    const asset = {
      name: "Tabs-1.4.0-arm64.zip",
      size: archive.length,
      sha512: createHash("sha512").update(archive).digest("base64"),
    };
    const fixture = createSignedManifest({
      assets: { arm64: asset, x64: { ...asset, name: "Tabs-1.4.0-x64.zip" } },
    });
    const updater = new MacPreviewUpdater({
      appBundlePath: Path.join(directory, "Tabs.app"),
      currentVersion: "1.3.34",
      repository: "PanicMako/Tabs-ide",
      arch: "arm64",
      tempDirectory: directory,
      downloadCacheDirectory: directory,
      manifestPublicKey: fixture.publicKey,
    });
    const metadata = (url: string) =>
      url.includes("api.github.com")
        ? Response.json([
            {
              tag_name: "v1.4.0",
              draft: false,
              prerelease: false,
              assets: [
                "tabs-mac-preview-update.json",
                "tabs-mac-preview-update.json.sig",
                "Tabs-1.4.0-arm64.zip",
                "Tabs-1.4.0-x64.zip",
              ].map((name) => ({ name })),
            },
          ])
        : url.endsWith(".sig")
          ? new Response(fixture.signature)
          : new Response(fixture.bytes);
    return { directory, updater, metadata };
  }

  it.each([403, 429])(
    "verifies the latest signed release when the list returns HTTP %s",
    async (status) => {
      const archive = Buffer.from("signed archive bytes");
      const { directory, updater, metadata } = await setup(archive);
      const releasesUrl = "https://github.com/PanicMako/Tabs-ide/releases";
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith("https://api.github.com/")) return new Response(null, { status });
        if (url === `${releasesUrl}/latest`) {
          expect(init?.redirect).toBe("manual");
          return Response.redirect(`${releasesUrl}/tag/v1.4.0`);
        }
        expect(url).toMatch(/\/download\/v1\.4\.0\//);
        return url.endsWith(".zip") ? new Response(archive) : metadata(url);
      });
      vi.stubGlobal("fetch", fetchMock);
      try {
        await expect(updater.checkForUpdates()).resolves.toMatchObject({ version: "1.4.0" });
        await expect(updater.downloadUpdate(vi.fn())).resolves.toBe("1.4.0");
      } finally {
        vi.unstubAllGlobals();
        await FSPromises.rm(directory, { recursive: true, force: true });
      }
    },
  );

  it.each([
    "https://github.com/another/repo/releases/tag/v1.4.0",
    "https://github.com/PanicMako/Tabs-ide/releases/tag/v1.4.0-beta.1",
    "https://github.com/PanicMako/Tabs-ide/releases/tag/v1.3.34",
  ])("keeps the GitHub error when the fallback release can't be used: %s", async (location) => {
    const { directory, updater } = await setup(Buffer.from("signed archive bytes"));
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith("https://api.github.com/")
        ? new Response(null, { status: 403 })
        : Response.redirect(location),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(updater.checkForUpdates()).rejects.toThrow("HTTP 403");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await expect(updater.downloadUpdate(vi.fn())).rejects.toThrow("No verified macOS update");
    } finally {
      vi.unstubAllGlobals();
      await FSPromises.rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    { "retry-after": "90" },
    { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1900000090" },
  ])("retries the GitHub API only after the rate limit expires (%j)", async (headers) => {
    const { directory, updater, metadata } = await setup(Buffer.from("signed archive bytes"));
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_900_000_000_000);
    let attempts = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/latest")) return new Response(null, { status: 404 });
      if (url.startsWith("https://api.github.com/") && ++attempts === 1) {
        return new Response(null, { status: 403, headers: new Headers(Object.entries(headers)) });
      }
      return metadata(url);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(updater.checkForUpdates()).rejects.toThrow(/HTTP 403.*Try again after/);
      clock.mockReturnValue(1_900_000_089_000);
      await expect(updater.checkForUpdates()).rejects.toThrow("HTTP 403");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      clock.mockReturnValue(1_900_000_090_000);
      await expect(updater.checkForUpdates()).resolves.toMatchObject({ version: "1.4.0" });
      expect(attempts).toBe(2);
    } finally {
      clock.mockRestore();
      vi.unstubAllGlobals();
      await FSPromises.rm(directory, { recursive: true, force: true });
    }
  });

  it("downloads through the public updater beyond two minutes while bytes keep arriving", async () => {
    const archive = Buffer.from("signed archive bytes");
    const { directory, updater, metadata } = await setup(archive);
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (!url.endsWith(".zip")) return metadata(url);
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(archive.subarray(0, 5));
                setTimeout(() => controller.enqueue(archive.subarray(5, 10)), 70_000);
                setTimeout(() => {
                  controller.enqueue(archive.subarray(10));
                  controller.close();
                }, 140_000);
              },
            }),
          );
        }),
      );
      await updater.checkForUpdates();
      const progress = vi.fn();
      const download = updater.downloadUpdate(progress);
      // Filesystem work must settle before advancing the simulated network clock.
      await vi.waitFor(() =>
        expect(progress.mock.calls.some(([percent]) => percent > 0)).toBe(true),
      );
      await vi.advanceTimersByTimeAsync(140_000);
      await expect(download).resolves.toBe("1.4.0");
      expect(progress).toHaveBeenLastCalledWith(100);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      await FSPromises.rm(directory, { recursive: true, force: true });
    }
  });

  it("retains verified-target partial bytes and resumes on the next download attempt", async () => {
    const archive = Buffer.from("complete signed archive");
    const { directory, updater, metadata } = await setup(archive);
    let attempt = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.endsWith(".zip")) return metadata(url);
      if (++attempt === 1) {
        let read = false;
        return new Response(
          new ReadableStream({
            pull(controller) {
              if (!read) {
                read = true;
                controller.enqueue(archive.subarray(0, 7));
              } else controller.error(new Error("network interrupted"));
            },
          }),
        );
      }
      expect(init?.headers).toMatchObject({ Range: "bytes=7-" });
      return new Response(archive.subarray(7), {
        status: 206,
        headers: { "Content-Range": `bytes 7-${archive.length - 1}/${archive.length}` },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await updater.checkForUpdates();
      await expect(updater.downloadUpdate(() => {})).rejects.toThrow("network interrupted");
      await expect(updater.downloadUpdate(() => {})).resolves.toBe("1.4.0");
      expect(attempt).toBe(2);
    } finally {
      vi.unstubAllGlobals();
      await FSPromises.rm(directory, { recursive: true, force: true });
    }
  });
});
