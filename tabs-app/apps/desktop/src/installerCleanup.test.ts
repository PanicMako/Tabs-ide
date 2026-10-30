import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, symlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  installedMacApplication,
  findDownloadedInstaller,
  installerFilename,
  trashVerifiedInstaller,
} from "./installerCleanup";

describe("installed DMG cleanup", () => {
  it("only enables for the packaged installed Mac app, never a mounted or development app", () => {
    expect(
      installedMacApplication(
        "darwin",
        true,
        "/Applications/Tabs.app/Contents/MacOS/Tabs",
        "/Users/test",
      ),
    ).toBe(true);
    expect(
      installedMacApplication(
        "darwin",
        true,
        "/Users/test/Applications/Tabs.app/Contents/MacOS/Tabs",
        "/Users/test",
      ),
    ).toBe(true);
    expect(
      installedMacApplication(
        "darwin",
        true,
        "/Volumes/Tabs/Tabs.app/Contents/MacOS/Tabs",
        "/Users/test",
      ),
    ).toBe(false);
    expect(
      installedMacApplication(
        "darwin",
        false,
        "/Applications/Tabs.app/Contents/MacOS/Tabs",
        "/Users/test",
      ),
    ).toBe(false);
    expect(
      installedMacApplication(
        "linux",
        true,
        "/Applications/Tabs.app/Contents/MacOS/Tabs",
        "/Users/test",
      ),
    ).toBe(false);
    expect(installerFilename("../../2.0.0", "arm64")).toBeNull();
  });

  it("preserves unknown, mismatched, modified and symlinked files; trashes only the verified download", async () => {
    const downloads = await mkdtemp(path.join(tmpdir(), "tabs-installer-cleanup-"));
    const file = path.join(downloads, "Tabs-2.0.0-arm64.dmg");
    const content = "published installer";
    const release = {
      tag_name: "v2.0.0",
      draft: false,
      published_at: "2026-10-22",
      assets: [
        {
          name: path.basename(file),
          size: content.length,
          digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
        },
      ],
    };
    const trash = vi.fn(async (_file: string) => undefined);
    const input = {
      downloads,
      version: "2.0.0",
      arch: "arm64",
      trash,
      fetchRelease: async () => release,
    };
    try {
      await writeFile(file, content);
      await expect(
        trashVerifiedInstaller({
          ...input,
          fetchRelease: async () => ({ ...release, draft: true }),
        }),
      ).rejects.toThrow("could not be verified");
      await expect(
        trashVerifiedInstaller({
          ...input,
          fetchRelease: async () => ({ ...release, assets: [] }),
        }),
      ).rejects.toThrow("could not be verified");
      await expect(
        trashVerifiedInstaller({
          ...input,
          fetchRelease: async () => {
            await writeFile(file, "changed after scanning");
            return release;
          },
        }),
      ).rejects.toThrow("changed");
      expect(trash).not.toHaveBeenCalled();
      await writeFile(file, content);
      await trashVerifiedInstaller(input);
      expect(trash).toHaveBeenCalledOnce();
      expect(trash).toHaveBeenCalledWith(
        await import("node:fs/promises").then((fs) => fs.realpath(file)),
      );
      expect(await readFile(file, "utf8")).toBe(content);
      await rm(file);
      await writeFile(path.join(downloads, "other.dmg"), content);
      await symlink(path.join(downloads, "other.dmg"), file);
      expect(await findDownloadedInstaller(downloads, "2.0.0", "arm64")).toBeNull();
    } finally {
      await rm(downloads, { recursive: true, force: true });
    }
  });
});
