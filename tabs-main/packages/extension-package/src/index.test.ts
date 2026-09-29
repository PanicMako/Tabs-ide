import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import * as Yazl from "yazl";
import { afterEach, describe, expect, it } from "vitest";
import { extractTabsext, inspectTabsext, packTabsext, validateTabsextDirectory } from "./index.ts";

const temporaryRoots: string[] = [];

function fixture(): { root: string; source: string } {
  const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-package-test-"));
  temporaryRoots.push(root);
  const source = Path.join(root, "source");
  FS.mkdirSync(Path.join(source, "dist"), { recursive: true });
  FS.writeFileSync(
    Path.join(source, "dist", "index.html"),
    "<!doctype html><title>Example</title>",
  );
  FS.writeFileSync(
    Path.join(source, "tabs-extension.json"),
    JSON.stringify({
      manifestVersion: 1,
      publisher: "example",
      name: "tool",
      version: "1.0.0",
      displayName: "Example Tool",
      description: "A test extension",
      engines: { tabs: ">=1.3.0 <2.0.0" },
      contributes: { tools: [{ id: "main", label: "Main", entry: "dist/index.html" }] },
    }),
  );
  return { root, source };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) FS.rmSync(root, { recursive: true, force: true });
});

describe(".tabsext packages", () => {
  it("rejects an output inside the source through a symlinked parent", async () => {
    const { root, source } = fixture();
    const alias = Path.join(root, "source-alias");
    FS.symlinkSync(source, alias, "dir");
    await expect(
      packTabsext({
        directory: source,
        destination: Path.join(alias, "nested.tabsext"),
        tabsVersion: "1.3.17",
      }),
    ).rejects.toThrow(/outside its source directory/);
    expect(FS.existsSync(Path.join(source, "nested.tabsext"))).toBe(false);
  });

  it("validates an unpacked package without writing an archive", () => {
    const { root, source } = fixture();
    const result = validateTabsextDirectory(source, "1.3.17");
    expect(result.id).toBe("example.tool");
    expect(result.files).toContain("dist/index.html");
    expect(FS.readdirSync(root)).toEqual(["source"]);
    const manifestPath = Path.join(source, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.engines.api = ">=2.0.0";
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => validateTabsextDirectory(source, "1.3.17")).toThrow(/engines.api/);
  });
  it("requires packaged logic bytes and preserves them on extraction", async () => {
    const { root, source } = fixture();
    const manifestPath = Path.join(source, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.engines.api = "^1.2.0";
    manifest.logic = { entry: "dist/logic.js" };
    manifest.contributes.commands = [{ id: "sum", label: "Sum", description: "Adds values" }];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => validateTabsextDirectory(source, "1.3.17")).toThrow(/Missing logic entry/);
    FS.writeFileSync(Path.join(source, "dist", "logic.js"), "globalThis.run = () => 3;");
    const archive = Path.join(root, "logic.tabsext");
    const packed = await packTabsext({
      directory: source,
      destination: archive,
      tabsVersion: "1.3.17",
    });
    const destination = Path.join(root, "installed");
    const extracted = await extractTabsext({
      archive,
      destination,
      expectedDigest: packed.digest,
      tabsVersion: "1.3.17",
    });
    expect(extracted.manifest.contributes.commands?.[0]?.id).toBe("sum");
    expect(FS.readFileSync(Path.join(destination, "dist", "logic.js"), "utf8")).toContain("run");
  });
  it("packs reproducibly and extracts an approved digest", async () => {
    const { root, source } = fixture();
    const first = Path.join(root, "first.tabsext");
    const second = Path.join(root, "second.tabsext");
    const one = await packTabsext({ directory: source, destination: first, tabsVersion: "1.3.17" });
    const two = await packTabsext({
      directory: source,
      destination: second,
      tabsVersion: "1.3.17",
    });
    expect(one.digest).toBe(two.digest);
    expect(one.id).toBe("example.tool");
    const destination = Path.join(root, "installed");
    await extractTabsext({
      archive: first,
      destination,
      expectedDigest: one.digest,
      tabsVersion: "1.3.17",
    });
    expect(FS.readFileSync(Path.join(destination, "dist", "index.html"), "utf8")).toContain(
      "Example",
    );
  });

  it("inspects an older release for registry review without making it desktop-compatible", async () => {
    const { root, source } = fixture();
    const archive = Path.join(root, "older.tabsext");
    const packed = await packTabsext({
      directory: source,
      destination: archive,
      tabsVersion: "1.3.17",
    });
    expect((await inspectTabsext(archive, null)).digest).toBe(packed.digest);
    await expect(inspectTabsext(archive, "2.0.0")).rejects.toThrow(/engines.tabs/);
    const extracted = await extractTabsext({
      archive,
      destination: Path.join(root, "registry-review"),
      expectedDigest: packed.digest,
      tabsVersion: null,
    });
    expect(extracted.manifest.name).toBe("tool");
  });

  it("produces identical bytes in different system timezones", () => {
    const { root, source } = fixture();
    const cli = Path.join(import.meta.dirname, "cli.ts");
    const archives = ["utc.tabsext", "india.tabsext"];
    for (const [index, timezone] of ["UTC", "Asia/Kolkata"].entries()) {
      const result = spawnSync(
        "bun",
        [cli, "pack", source, Path.join(root, archives[index]!), "--tabs-version", "1.3.17"],
        { encoding: "utf8", env: { ...process.env, TZ: timezone } },
      );
      expect(result.status, result.stderr).toBe(0);
    }
    expect(FS.readFileSync(Path.join(root, archives[0]!))).toEqual(
      FS.readFileSync(Path.join(root, archives[1]!)),
    );
  }, 20_000);

  it("does not replace an existing destination or extract a mismatched digest", async () => {
    const { root, source } = fixture();
    const archive = Path.join(root, "tool.tabsext");
    FS.writeFileSync(archive, "keep me");
    await expect(
      packTabsext({ directory: source, destination: archive, tabsVersion: "1.3.17" }),
    ).rejects.toThrow(/already exists/);
    expect(FS.readFileSync(archive, "utf8")).toBe("keep me");
    FS.unlinkSync(archive);
    await packTabsext({ directory: source, destination: archive, tabsVersion: "1.3.17" });
    const destination = Path.join(root, "installed");
    await expect(
      extractTabsext({
        archive,
        destination,
        expectedDigest: "0".repeat(64),
        tabsVersion: "1.3.17",
      }),
    ).rejects.toThrow(/digest mismatch/);
    expect(FS.existsSync(destination)).toBe(false);
  });

  it("rejects symlinked source files and case-colliding archive paths", async () => {
    const { root, source } = fixture();
    FS.symlinkSync(
      Path.join(source, "dist", "index.html"),
      Path.join(source, "dist", "linked.html"),
    );
    await expect(
      packTabsext({
        directory: source,
        destination: Path.join(root, "tool.tabsext"),
        tabsVersion: "1.3.17",
      }),
    ).rejects.toThrow(/link or special file/);
    const zip = new Yazl.ZipFile();
    zip.addBuffer(Buffer.from("one"), "A.txt");
    zip.addBuffer(Buffer.from("two"), "a.txt");
    zip.end();
    const malformed = Path.join(root, "colliding.tabsext");
    await pipeline(zip.outputStream, FS.createWriteStream(malformed));
    await expect(inspectTabsext(malformed, "1.3.17")).rejects.toThrow(/colliding package path/);
  });

  it("rejects a ZIP entry that traverses outside its extraction root", async () => {
    const { root } = fixture();
    const zip = new Yazl.ZipFile();
    zip.addBuffer(Buffer.from("untrusted"), "safe.txt");
    zip.end();
    const archive = Path.join(root, "traversal.tabsext");
    await pipeline(zip.outputStream, FS.createWriteStream(archive));
    const bytes = FS.readFileSync(archive);
    const original = Buffer.from("safe.txt");
    const traversal = Buffer.from("../e.txt");
    let offset = 0;
    let replacements = 0;
    while ((offset = bytes.indexOf(original, offset)) >= 0) {
      traversal.copy(bytes, offset);
      offset += original.length;
      replacements++;
    }
    expect(replacements).toBe(2);
    FS.writeFileSync(archive, bytes);
    await expect(inspectTabsext(archive, "1.3.17")).rejects.toThrow(
      /invalid relative path|Invalid package path/,
    );
    await expect(
      extractTabsext({
        archive,
        destination: Path.join(root, "installed"),
        expectedDigest: "0".repeat(64),
        tabsVersion: "1.3.17",
      }),
    ).rejects.toThrow();
    expect(FS.existsSync(Path.join(root, "e.txt"))).toBe(false);
  });
});
