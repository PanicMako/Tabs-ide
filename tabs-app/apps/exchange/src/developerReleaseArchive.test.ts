import { describe, expect, it } from "vitest";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { preserveDeveloperReleases } from "../../../scripts/developer-release-archive.mjs";

describe("immutable developer release retention", () => {
  it("restores older versioned bytes after output replacement without replacing latest metadata", () => {
    const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-release-retention-"));
    try {
      const output = Path.join(root, "output");
      const archive = Path.join(root, "archive");
      const release = "1.7.0-0123456789abcdef";
      FS.mkdirSync(Path.join(output, release), { recursive: true });
      FS.writeFileSync(Path.join(output, release, "README.md"), "original");
      FS.writeFileSync(Path.join(output, "manifest.json"), "old latest");
      preserveDeveloperReleases(output, archive);
      FS.renameSync(output, Path.join(root, "previous-output"));
      FS.mkdirSync(output);
      FS.writeFileSync(Path.join(output, "manifest.json"), "new latest");
      preserveDeveloperReleases(archive, output);
      expect(FS.readFileSync(Path.join(output, release, "README.md"), "utf8")).toBe("original");
      expect(FS.readFileSync(Path.join(output, "manifest.json"), "utf8")).toBe("new latest");
      FS.writeFileSync(Path.join(output, release, "README.md"), "changed");
      expect(() => preserveDeveloperReleases(output, archive)).toThrow("collision");
      expect(FS.readFileSync(Path.join(archive, release, "README.md"), "utf8")).toBe("original");
    } finally {
      FS.rmSync(root, { recursive: true, force: true });
    }
  });
});
