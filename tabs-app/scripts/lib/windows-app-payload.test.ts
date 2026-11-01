import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertWindowsAppArchiveLean,
  excludedWindowsAppFile,
  trimWindowsAppArchive,
} from "./windows-app-payload";

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve("electron-builder/package.json"));
const packagerRequire = createRequire(builderRequire.resolve("app-builder-lib/package.json"));
const asar = packagerRequire("@electron/asar") as {
  createPackageWithOptions: (
    source: string,
    archive: string,
    options: { unpack: string },
  ) => Promise<void>;
  extractFile: (archive: string, file: string) => Buffer;
  uncache: (archive: string) => void;
  listPackage: (archive: string) => string[];
};

describe("Windows app archive payload", () => {
  it("removes only the duplicate editor tree and generated application maps", () => {
    expect(excludedWindowsAppFile("apps/desktop/resources/tabs-code-oss/out/main.js")).toBe(true);
    expect(excludedWindowsAppFile("apps/server/dist/client/assets/worker.js.map")).toBe(true);
    expect(
      excludedWindowsAppFile(
        "apps/desktop/prod-resources/code-oss-extensions/defaults/package.json",
      ),
    ).toBe(false);
    expect(excludedWindowsAppFile("apps/server/dist/client/assets/worker.js")).toBe(false);
    expect(excludedWindowsAppFile("node_modules/sdk/source.js.map")).toBe(false);
  });
  it("rewrites a real ASAR while preserving code, Unicode paths and unpacked native bytes", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "tabs-asar-test-"));
    try {
      const source = path.join(temporary, "source");
      const archive = path.join(temporary, "app.asar");
      const files = {
        "package.json": '{"name":"tabs-test"}',
        "apps/desktop/dist-electron/main.js": "export const answer = 42;\n",
        "apps/desktop/dist-electron/main.js.map": "debug-only",
        "apps/desktop/resources/tabs-code-oss/out/main.js": "spare editor copy",
        "node_modules/sdk/native.node": "native-binary-bytes",
        "assets/\u03b1.txt": "Unicode content",
      };
      for (const [name, contents] of Object.entries(files)) {
        const filename = path.join(source, name);
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(filename, contents);
      }
      await asar.createPackageWithOptions(source, archive, { unpack: "**/*.node" });
      expect(() => assertWindowsAppArchiveLean(archive)).toThrow("Redundant");
      const removed = trimWindowsAppArchive(archive);
      expect(removed).toBe(Buffer.byteLength("debug-onlyspare editor copy"));
      asar.uncache(archive);
      for (const [name, contents] of Object.entries(files)) {
        if (!excludedWindowsAppFile(name))
          expect(asar.extractFile(archive, name).toString()).toBe(contents);
      }
      expect(asar.listPackage(archive).some((name) => name.includes("tabs-code-oss"))).toBe(false);
      expect(() => assertWindowsAppArchiveLean(archive)).not.toThrow();
      expect(trimWindowsAppArchive(archive)).toBe(0);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });
  it("rejects malformed archives without replacing the original", () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "tabs-asar-invalid-"));
    try {
      const archive = path.join(temporary, "bad.asar");
      fs.writeFileSync(archive, "not an archive");
      expect(() => trimWindowsAppArchive(archive)).toThrow("Invalid ASAR");
      expect(fs.readFileSync(archive, "utf8")).toBe("not an archive");
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });
});
