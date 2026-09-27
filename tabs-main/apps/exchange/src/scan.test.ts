import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { extractTabsext, packTabsext } from "@tabs/extension-package";
import { afterEach, describe, expect, it } from "vitest";
import { scanExtractedPackage } from "./scan.ts";

const roots: string[] = [];

async function packageFixture(
  extra?: Record<string, string | Buffer>,
  capabilities?: string[],
  displayName = "Dashboard",
  networkHosts?: string[],
  manifestOverrides?: Record<string, unknown>,
) {
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
      displayName,
      description: "A test extension",
      engines: { tabs: ">=1.3.0 <2.0.0" },
      ...(capabilities ? { capabilities } : {}),
      ...(networkHosts ? { networkHosts } : {}),
      contributes: { tools: [{ id: "main", label: "Main", entry: "dist/index.html" }] },
      ...manifestOverrides,
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

  it("blocks operator-listed package and contained-file digests", async () => {
    const { destination, inspected } = await packageFixture({ "payload.txt": "known material" });
    const fileDigest = Crypto.createHash("sha256").update("known material").digest("hex");
    const result = await scanExtractedPackage(
      destination,
      inspected,
      undefined,
      {},
      undefined,
      new Set([inspected.digest, fileDigest]),
    );
    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual({
      severity: "blocking",
      code: "known-malicious-package",
    });
    expect(result.issues).toContainEqual({
      severity: "blocking",
      code: "known-malicious-file",
      file: "dist/payload.txt",
    });
  });

  it("blocks executable magic even when a native binary is disguised as a text asset", async () => {
    const pe = Buffer.alloc(128);
    pe.write("MZ", 0, "ascii");
    pe.writeUInt32LE(64, 0x3c);
    pe.write("PE\0\0", 64, "binary");
    const { destination, inspected } = await packageFixture({
      "disguised.txt": Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2]),
      "other.txt": pe,
      "module.txt": Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]),
    });
    const result = await scanExtractedPackage(destination, inspected);
    expect(result.passed).toBe(false);
    expect(
      result.issues
        .filter((issue) => issue.code === "native-executable")
        .map((issue) => issue.file),
    ).toEqual(expect.arrayContaining(["dist/disguised.txt", "dist/other.txt", "dist/module.txt"]));
  });

  it("scans extensionless and large text files for secrets", async () => {
    const { destination, inspected } = await packageFixture({
      credentials: `${" ".repeat(1024 * 1024)}-----BEGIN PRIVATE KEY-----`,
    });
    const result = await scanExtractedPackage(destination, inspected);
    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual({
      severity: "blocking",
      code: "possible-secret",
      file: "dist/credentials",
    });
  });

  it("warns reviewers about nested archives and official-looking names", async () => {
    const { destination, inspected } = await packageFixture(
      { "payload.zip": "nested" },
      undefined,
      "Tabs Official Dashboard",
    );
    const result = await scanExtractedPackage(destination, inspected);
    expect(result.passed).toBe(true);
    expect(result.issues).toContainEqual({
      severity: "warning",
      code: "nested-archive",
      file: "dist/payload.zip",
    });
    expect(result.issues).toContainEqual({
      severity: "warning",
      code: "possible-official-impersonation",
    });
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

  it("shows added capabilities against the last approved version", async () => {
    const { destination, inspected } = await packageFixture({}, ["profile-storage"]);
    const result = await scanExtractedPackage(
      destination,
      inspected,
      { capabilities: [], contributes: inspected.manifest.contributes },
      {},
      "1.0.0",
    );
    expect(result.comparisonVersion).toBe("1.0.0");
    expect(result.capabilityChanges).toEqual({ added: ["profile-storage"], removed: [] });
    expect(result.issues).toContainEqual({ severity: "warning", code: "capabilities-increased" });
  });

  it("reports removed capabilities without marking them as an increase", async () => {
    const { destination, inspected } = await packageFixture();
    const result = await scanExtractedPackage(
      destination,
      inspected,
      { capabilities: ["profile-storage"], contributes: inspected.manifest.contributes },
      {},
      "1.0.0",
    );
    expect(result.capabilityChanges).toEqual({ added: [], removed: ["profile-storage"] });
    expect(result.issues).not.toContainEqual({
      severity: "warning",
      code: "capabilities-increased",
    });
  });

  it("shows newly requested network destinations as permission increases", async () => {
    const { destination, inspected } = await packageFixture({}, ["network"], "Dashboard", [
      "api.example.com",
      "new.example.com",
    ]);
    const result = await scanExtractedPackage(
      destination,
      inspected,
      {
        capabilities: ["network"],
        networkHosts: ["api.example.com"],
        contributes: inspected.manifest.contributes,
      },
      {},
      "1.0.0",
    );
    expect(result.capabilityChanges.added).toEqual(["network host: new.example.com"]);
    expect(result.issues).toContainEqual({ severity: "warning", code: "capabilities-increased" });
  });

  it("reports newly exposed AI commands to the reviewer", async () => {
    const command = { id: "sum", label: "Sum", description: "Add numbers", aiCallable: true };
    const { destination, inspected } = await packageFixture(
      { "logic.js": "globalThis.run = () => 0;" },
      ["ai-tools"],
      "Dashboard",
      undefined,
      {
        engines: { tabs: ">=1.3.0 <2.0.0", api: "^1.3.0" },
        logic: { entry: "dist/logic.js" },
        contributes: {
          tools: [{ id: "main", label: "Main", entry: "dist/index.html" }],
          commands: [command],
        },
      },
    );
    const result = await scanExtractedPackage(
      destination,
      inspected,
      {
        capabilities: ["ai-tools"],
        contributes: {
          ...inspected.manifest.contributes,
          commands: [{ ...command, aiCallable: false }],
        },
      },
      {},
      "0.9.0",
    );
    expect(result.capabilityChanges.added).toEqual(["AI-callable command: sum"]);
    expect(result.issues).toContainEqual({ severity: "warning", code: "capabilities-increased" });
  });

  it("highlights declared storage migrations for version review", async () => {
    const migrations = [{ from: 1, to: 2, renames: [{ from: "oldTheme", to: "theme" }] }];
    const { destination, inspected } = await packageFixture(
      {},
      ["profile-storage"],
      "Dashboard",
      undefined,
      {
        engines: { tabs: ">=1.3.0 <2.0.0", api: "^1.4.0" },
        storage: { version: 2, migrations },
      },
    );
    const result = await scanExtractedPackage(
      destination,
      inspected,
      { capabilities: ["profile-storage"], contributes: inspected.manifest.contributes },
      {},
      "0.9.0",
    );
    expect(result.passed).toBe(true);
    expect(result.issues).toContainEqual({ severity: "warning", code: "storage-schema-changed" });
    expect(result.storageChanges).toEqual({
      fromVersion: 1,
      toVersion: 2,
      definitionChanged: true,
      migrations,
    });
  });

  it("blocks a storage schema downgrade that desktop clients cannot install", async () => {
    const { destination, inspected } = await packageFixture(
      {},
      ["profile-storage"],
      "Dashboard",
      undefined,
      {
        engines: { tabs: ">=1.3.0 <2.0.0", api: "^1.4.0" },
        storage: { version: 1 },
      },
    );
    const result = await scanExtractedPackage(
      destination,
      inspected,
      {
        capabilities: ["profile-storage"],
        contributes: inspected.manifest.contributes,
        storage: {
          version: 2,
          migrations: [{ from: 1, to: 2, renames: [{ from: "oldTheme", to: "theme" }] }],
        },
      },
      {},
      "0.9.0",
    );
    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual({
      severity: "blocking",
      code: "storage-schema-downgrade",
    });
    expect(result.storageChanges).toMatchObject({ fromVersion: 2, toVersion: 1 });
  });
});
