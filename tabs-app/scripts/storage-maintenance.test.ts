import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  utimes,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  installerVersion,
  publishedDigest,
  scanDirectory,
  removeCandidate,
} from "./storage-maintenance";

const digest = `sha256:${"a".repeat(64)}`;
const installer = "Tabs-2.0.1-arm64.dmg";
const release = {
  tag_name: "v2.0.1",
  draft: false,
  published_at: "2026-10-20",
  assets: [{ name: installer, size: 42, digest }],
};

describe("storage maintenance", () => {
  it("requires published matching assets and preserves latest, drafts and missing digests", () => {
    expect(installerVersion(installer)).toBe("2.0.1");
    expect(installerVersion("../Tabs-2.0.1-arm64.dmg")).toBeNull();
    expect(publishedDigest(installer, 42, release, "v2.0.2")).toBe(digest);
    expect(publishedDigest(installer, 42, release, "v2.0.1")).toBeNull();
    expect(publishedDigest(installer, 42, { ...release, draft: true }, "v2.0.2")).toBeNull();
    expect(publishedDigest(installer, 42, { ...release, published_at: null }, "v2.0.2")).toBeNull();
    expect(publishedDigest(installer, 41, release, "v2.0.2")).toBeNull();
    expect(
      publishedDigest(
        installer,
        42,
        { ...release, assets: [{ name: installer, size: 42 }] },
        "v2.0.2",
      ),
    ).toBeNull();
    expect(publishedDigest(installer, 42, release, null)).toBeNull();
  });

  it("previews aged ignored files only, never source, fresh files, symlinks or directories", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "tabs-storage-safety-")));
    try {
      await mkdir(path.join(root, "cache"));
      for (const name of [
        "aaaaaaaaaaaaaaaa.tar.zst",
        "bbbbbbbbbbbbbbbb.tar.zst",
        "cccccccccccccccc.tar.zst",
        "notes.md",
      ]) {
        const file = path.join(root, "cache", name);
        await writeFile(file, "preserve");
        if (name !== "bbbbbbbbbbbbbbbb.tar.zst") await utimes(file, new Date(0), new Date(0));
      }
      await symlink(
        path.join(root, "cache/notes.md"),
        path.join(root, "cache/dddddddddddddddd.tar.zst"),
      );
      await mkdir(path.join(root, "cache/eeeeeeeeeeeeeeee.tar.zst"));
      const candidates = await scanDirectory(
        root,
        "cache",
        "cache",
        Date.now() - 1000,
        () => null,
        (name) => !name.endsWith("cccccccccccccccc.tar.zst"),
      );
      expect(candidates.map((file) => path.basename(file.file))).toEqual([
        "aaaaaaaaaaaaaaaa.tar.zst",
      ]);
      expect(await readFile(candidates[0]!.file, "utf8")).toBe("preserve");
      await writeFile(candidates[0]!.file, "updated by another build");
      expect(await removeCandidate(candidates[0]!)).toBe(false);
      expect(await readFile(candidates[0]!.file, "utf8")).toBe("updated by another build");
      await symlink(path.join(root, "cache"), path.join(root, "linked-cache"));
      expect(
        await scanDirectory(
          root,
          "linked-cache",
          "cache",
          Date.now(),
          () => null,
          () => true,
        ),
      ).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("hash-verifies installers before deletion and skips tampered or unpublished files", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "tabs-storage-digest-")));
    try {
      await mkdir(path.join(root, "release"));
      await writeFile(path.join(root, "release", installer), "verified upload");
      const hash = `sha256:${createHash("sha256").update("verified upload").digest("hex")}`;
      const candidates = await scanDirectory(
        root,
        "release",
        "installer",
        Date.now() + 1000,
        () => hash,
        () => true,
      );
      expect(candidates).toHaveLength(1);
      expect(await removeCandidate({ ...candidates[0]!, digest })).toBe(false);
      expect(await readFile(candidates[0]!.file, "utf8")).toBe("verified upload");
      expect(await removeCandidate(candidates[0]!)).toBe(true);
      await writeFile(path.join(root, "release", installer), "unpublished");
      expect(
        await scanDirectory(
          root,
          "release",
          "installer",
          Date.now() + 1000,
          () => null,
          () => true,
        ),
      ).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
