import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";

import { sanitizeMacAppSymlinks } from "./mac-symlink-sanitizer.ts";

describe("mac app symlink sanitization", () => {
  it("removes dangling symlinks, dereferences external links, and preserves internal links", () => {
    const root = mkdtempSync(join(tmpdir(), "tabs-symlink-test-"));
    const appDir = join(root, "Tabs.app");
    const contentsDir = join(appDir, "Contents");
    const resourcesDir = join(contentsDir, "Resources");
    const frameworksDir = join(contentsDir, "Frameworks");
    const outsideDir = join(root, "outside");

    mkdirSync(resourcesDir, { recursive: true });
    mkdirSync(frameworksDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });

    // 1. External file and directory targets
    const outsideFile = join(outsideDir, "external.txt");
    writeFileSync(outsideFile, "external-payload");
    const outsideSubDir = join(outsideDir, "external-dir");
    mkdirSync(outsideSubDir, { recursive: true });
    writeFileSync(join(outsideSubDir, "nested.txt"), "nested-payload");

    // 2. Symlinks inside the app bundle pointing outside
    const externalLinkFile = join(resourcesDir, "link-to-external-file.txt");
    symlinkSync(outsideFile, externalLinkFile);
    const externalLinkDir = join(resourcesDir, "link-to-external-dir");
    symlinkSync(outsideSubDir, externalLinkDir);

    // 3. Dangling symlink
    const danglingLink = join(resourcesDir, "broken-link.txt");
    symlinkSync(join(outsideDir, "does-not-exist.txt"), danglingLink);

    // 4. Valid internal symlink
    const internalTarget = join(frameworksDir, "Target.txt");
    writeFileSync(internalTarget, "internal-target-payload");
    const internalLink = join(frameworksDir, "internal-link.txt");
    symlinkSync(join(frameworksDir, "Target.txt"), internalLink);

    // Run sanitizer
    sanitizeMacAppSymlinks(appDir);

    // Assertions
    // Dangling link removed:
    expect(existsSync(danglingLink)).toBe(false);

    // External file link converted to a regular file (not a symlink) with matching content:
    expect(lstatSync(externalLinkFile).isSymbolicLink()).toBe(false);
    expect(readFileSync(externalLinkFile, "utf8")).toBe("external-payload");

    // External directory link converted to a real directory (not a symlink) with nested file intact:
    expect(lstatSync(externalLinkDir).isSymbolicLink()).toBe(false);
    expect(lstatSync(externalLinkDir).isDirectory()).toBe(true);
    expect(readFileSync(join(externalLinkDir, "nested.txt"), "utf8")).toBe("nested-payload");

    // Internal symlink preserved as a symbolic link:
    expect(lstatSync(internalLink).isSymbolicLink()).toBe(true);
    expect(readFileSync(internalLink, "utf8")).toBe("internal-target-payload");

    // Clean up
    rmSync(root, { recursive: true, force: true });
  });

  const testUnixSocket = process.platform === "win32" ? it.skip : it;
  testUnixSocket("preserves a required link when its target cannot be copied", async () => {
    const root = mkdtempSync(join(tmpdir(), "tabs-symlink-failure-"));
    const appDir = join(root, "Tabs.app");
    const resourcesDir = join(appDir, "Contents", "Resources");
    const socketPath = join(root, "service.sock");
    const linkPath = join(resourcesDir, "service.sock");
    mkdirSync(resourcesDir, { recursive: true });
    const server = createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, resolve);
      });
      symlinkSync(socketPath, linkPath);
      expect(() => sanitizeMacAppSymlinks(appDir)).toThrow("symlink");
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    }
  });

  const testOnDarwin = process.platform === "darwin" ? it : it.skip;
  testOnDarwin(
    "passes codesign --verify --deep --strict on macOS after sanitizing external symlinks",
    () => {
      const root = mkdtempSync(join(tmpdir(), "tabs-codesign-test-"));
      const appDir = join(root, "Tabs.app");
      const contentsDir = join(appDir, "Contents");
      const macosDir = join(contentsDir, "MacOS");
      const resourcesDir = join(contentsDir, "Resources");
      const outsideDir = join(root, "outside");

      mkdirSync(macosDir, { recursive: true });
      mkdirSync(resourcesDir, { recursive: true });
      mkdirSync(outsideDir, { recursive: true });

      // Minimal bundle executable & Info.plist
      const testBin = join(macosDir, "Tabs");
      writeFileSync(testBin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      writeFileSync(
        join(contentsDir, "Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>Tabs</string>
  <key>CFBundleIdentifier</key>
  <string>com.tabs.test</string>
</dict>
</plist>`,
      );

      // Create external symlink that would otherwise fail codesign --strict
      const outsideTarget = join(outsideDir, "helper.txt");
      writeFileSync(outsideTarget, "payload");
      const linkInBundle = join(resourcesDir, "helper-link.txt");
      symlinkSync(outsideTarget, linkInBundle);

      // Sanitize
      sanitizeMacAppSymlinks(appDir);

      // Codesign ad-hoc and verify strictly
      const signRes = spawnSync("codesign", ["--force", "--deep", "--sign", "-", appDir]);
      expect(signRes.status).toBe(0);

      const verifyRes = spawnSync("codesign", ["--verify", "--deep", "--strict", appDir]);
      expect(verifyRes.status).toBe(0);

      rmSync(root, { recursive: true, force: true });
    },
  );
});
