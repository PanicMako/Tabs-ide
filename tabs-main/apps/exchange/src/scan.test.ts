import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { extractTabsext, packTabsext } from "@tabs/extension-package";
import { afterEach, describe, expect, it } from "vitest";
import { scanExtractedPackage } from "./scan.ts";

const roots: string[] = [];

async function packageFixture(extra?: Record<string, string>) {
  const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-exchange-scan-test-"));
  roots.push(root);
  const source = Path.join(root, "source");
  FS.mkdirSync(Path.join(source, "dist"), { recursive: true });
  FS.writeFileSync(Path.join(source, "dist", "index.html"), "<!doctype html><title>Test</title>");
  FS.writeFileSync(
    Path.join(source, "tabs-extension.json"),
    JSON.stringify({
      manifestVersion: 1,
      publisher: "example",
      name: "dashboard",
      version: "1.0.0",
      displayName: "Dashboard",
      description: "A test extension",
      engines: { tabs: ">=1.3.0 <2.0.0" },
      contributes: { tools: [{ id: "main", label: "Main", entry: "dist/index.html" }] },
    }),
  );
  for (const [file, contents] of Object.entries(extra ?? {})) {
    FS.writeFileSync(Path.join(source, "dist", file), contents);
  }
  const archive = Path.join(root, "package.tabsext");
  const packed = await packTabsext({
    directory: source,
    destination: archive,
    tabsVersion: "1.3.17",
  });
  const destination = Path.join(root, "extracted");
  const inspected = await extractTabsext({
    archive,
    destination,
    expectedDigest: packed.digest,
    tabsVersion: "1.3.17",
  });
  return { destination, inspected };
}

afterEach(() => {
  for (const root of roots.splice(0)) FS.rmSync(root, { recursive: true, force: true });
});

describe("Exchange automated scan", () => {
  it("passes a simple UI-only package", async () => {
    const { destination, inspected } = await packageFixture();
    const result = await scanExtractedPackage(destination, inspected);
    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.digest).toBe(inspected.digest);
    expect(result.changes.added).toContain("dist/index.html");
  });

  it("blocks a leaked private key and native executable", async () => {
    const { destination, inspected } = await packageFixture({
      "config.txt": "-----BEGIN PRIVATE KEY-----\nsecret\n",
      "helper.exe": "binary",
    });
    const result = await scanExtractedPackage(destination, inspected);
    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("possible-secret");
    expect(result.issues.map((issue) => issue.code)).toContain("native-executable");
  });

  it("flags changed contributions for manual review", async () => {
    const { destination, inspected } = await packageFixture();
    const result = await scanExtractedPackage(
      destination,
      inspected,
      { contributes: { tools: [] } },
      { "dist/index.html": "0".repeat(64), "removed.txt": "1".repeat(64) },
    );
    expect(result.passed).toBe(true);
    expect(result.issues).toContainEqual({ severity: "warning", code: "contributions-changed" });
    expect(result.changes.modified).toContain("dist/index.html");
    expect(result.changes.removed).toContain("removed.txt");
  });
});
