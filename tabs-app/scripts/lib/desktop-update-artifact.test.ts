import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseUpdateFileEntries, verifyDesktopUpdateArtifact } from "./desktop-update-artifact";

function fixture(platform: "linux" | "win") {
  const directory = mkdtempSync(join(tmpdir(), "tabs-update-artifact-test-"));
  const filename = platform === "linux" ? "Tabs-2.0.0-x86_64.AppImage" : "Tabs-2.0.0-x64.exe";
  const bytes =
    platform === "linux" ? Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1]) : Buffer.from("MZfixture");
  const artifactPath = join(directory, filename);
  writeFileSync(artifactPath, bytes);
  if (platform === "linux") chmodSync(artifactPath, 0o755);
  else writeFileSync(`${artifactPath}.blockmap`, "blockmap");
  const sha512 = createHash("sha512").update(bytes).digest("base64");
  const manifestName = platform === "linux" ? "latest-linux.yml" : "latest.yml";
  writeFileSync(
    join(directory, manifestName),
    `version: 2.0.0\nfiles:\n  - url: ${filename}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${filename}\nsha512: ${sha512}\n`,
  );
  return { artifactPath, directory };
}

describe("desktop update artifact verification", () => {
  it("parses electron-builder update entries", () => {
    expect(
      parseUpdateFileEntries("files:\n  - url: Tabs.exe\n    sha512: abc=\n    size: 42\n"),
    ).toEqual([{ url: "Tabs.exe", sha512: "abc=", size: 42 }]);
  });

  it.each(["linux", "win"] as const)(
    "verifies a %s artifact against its manifest",
    async (platform) => {
      const { artifactPath, directory } = fixture(platform);
      await expect(
        verifyDesktopUpdateArtifact(directory, platform, "2.0.0"),
      ).resolves.toMatchObject({
        artifactPath,
      });
    },
  );

  it("rejects an artifact changed after metadata generation", async () => {
    const { artifactPath, directory } = fixture("win");
    writeFileSync(artifactPath, "MZtampered");
    await expect(verifyDesktopUpdateArtifact(directory, "win", "2.0.0")).rejects.toThrow(
      /size|sha512/,
    );
  });
});
