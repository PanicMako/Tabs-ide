import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import {
  Key,
  MetaFile,
  Metadata,
  Root,
  Signature,
  Snapshot,
  TargetFile,
  Targets,
  Timestamp,
} from "@tufjs/models";
import { afterEach, describe, expect, it } from "vitest";
import {
  ExchangeMetadataFetcher,
  ExchangeTransportError,
  TrustedExchange,
  exchangeTargetPath,
} from "./trustedExchange";

const origin = "https://exchange.tabs.example";
const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-tuf-test-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    FS.rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const { privateKey, publicKey } = Crypto.generateKeyPairSync("ed25519");
  const publicBytes = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const keyID = Crypto.createHash("sha256").update(publicBytes).digest("hex");
  const key = new Key({
    keyID,
    keyType: "ed25519",
    scheme: "ed25519",
    keyVal: { public: publicBytes.toString("hex") },
  });
  const common = { version: 1, specVersion: "1.0.0", expires: "2030-01-01T00:00:00Z" };
  const sign = <T extends Root | Targets | Snapshot | Timestamp>(signed: T): Buffer => {
    const metadata = new Metadata(signed);
    metadata.sign(
      (bytes) =>
        new Signature({ keyID, sig: Crypto.sign(null, bytes, privateKey).toString("hex") }),
    );
    return Buffer.from(JSON.stringify(metadata.toJSON()));
  };
  const root = new Root({ ...common, consistentSnapshot: false });
  for (const role of ["root", "timestamp", "snapshot", "targets"]) root.addKey(key, role);
  const rootBytes = sign(root);
  const path = exchangeTargetPath("acme", "dashboard", "1.0.0");
  const targetBytes = Buffer.from("example tabsext bytes");
  const digest = Crypto.createHash("sha256").update(targetBytes).digest("hex");
  const metadata: Record<string, Buffer> = {};
  const publish = (version: number, includeTarget: boolean, expires = common.expires) => {
    const fields = { ...common, version, expires };
    const targetsBytes = sign(
      new Targets({
        ...fields,
        targets: includeTarget
          ? {
              [path]: new TargetFile({
                path,
                length: targetBytes.length,
                hashes: { sha256: digest },
              }),
            }
          : {},
      }),
    );
    const snapshotBytes = sign(
      new Snapshot({
        ...fields,
        meta: {
          "targets.json": new MetaFile({
            version,
            length: targetsBytes.length,
            hashes: { sha256: Crypto.createHash("sha256").update(targetsBytes).digest("hex") },
          }),
        },
      }),
    );
    const timestampBytes = sign(
      new Timestamp({
        ...fields,
        snapshotMeta: new MetaFile({
          version,
          length: snapshotBytes.length,
          hashes: { sha256: Crypto.createHash("sha256").update(snapshotBytes).digest("hex") },
        }),
      }),
    );
    metadata["timestamp.json"] = timestampBytes;
    metadata["snapshot.json"] = snapshotBytes;
    metadata["targets.json"] = targetsBytes;
  };
  publish(1, true);
  const rotateRoot = (signWithNewKey: boolean) => {
    const rotated = Crypto.generateKeyPairSync("ed25519");
    const publicBytes = rotated.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const rotatedKeyID = Crypto.createHash("sha256").update(publicBytes).digest("hex");
    const rotatedKey = new Key({
      keyID: rotatedKeyID,
      keyType: "ed25519",
      scheme: "ed25519",
      keyVal: { public: publicBytes.toString("hex") },
    });
    const nextRoot = new Root({ ...common, version: 2, consistentSnapshot: false });
    nextRoot.addKey(rotatedKey, "root");
    for (const role of ["timestamp", "snapshot", "targets"]) nextRoot.addKey(key, role);
    const signed = new Metadata(nextRoot);
    signed.sign(
      (bytes) =>
        new Signature({ keyID, sig: Crypto.sign(null, bytes, privateKey).toString("hex") }),
    );
    if (signWithNewKey) {
      signed.sign(
        (bytes) =>
          new Signature({
            keyID: rotatedKeyID,
            sig: Crypto.sign(null, bytes, rotated.privateKey).toString("hex"),
          }),
      );
    }
    metadata["2.root.json"] = Buffer.from(JSON.stringify(signed.toJSON()));
    publish(2, true);
  };
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    const filename = url.split("/").at(-1)!;
    const bytes = metadata[filename];
    const response = new Response(bytes ? new Uint8Array(bytes) : null, {
      status: bytes ? 200 : 404,
    });
    Object.defineProperty(response, "url", { value: url });
    return response;
  };
  return { rootBytes, metadata, fetcher, digest, targetBytes, path, publish, rotateRoot };
}

describe("trusted Exchange metadata", () => {
  it("advances from a pinned root only through a dual-signed rotation", async () => {
    const source = fixture();
    const stateRoot = temporaryDirectory();
    const trusted = new TrustedExchange({
      origin,
      trustId: "rotation-test",
      initialRoot: source.rootBytes,
      stateRoot,
      fetcher: source.fetcher,
    });
    expect(await trusted.resolve("acme", "dashboard", "1.0.0")).not.toBeNull();
    source.rotateRoot(false);
    await expect(trusted.resolve("acme", "dashboard", "1.0.0")).rejects.toThrow();
    source.rotateRoot(true);
    expect(await trusted.resolve("acme", "dashboard", "1.0.0")).not.toBeNull();
    const metadataDirectory = Path.join(stateRoot, FS.readdirSync(stateRoot)[0]!);
    const persisted = JSON.parse(
      FS.readFileSync(Path.join(metadataDirectory, "root.json"), "utf8"),
    );
    expect(persisted.signed.version).toBe(2);
    source.publish(1, true);
    await expect(trusted.resolve("acme", "dashboard", "1.0.0")).rejects.toThrow();
  });

  it("rejects target identities that could escape their namespace", () => {
    expect(() => exchangeTargetPath("../acme", "dashboard", "1.0.0")).toThrow();
    expect(() => exchangeTargetPath("acme", "dashboard", "../../file")).toThrow();
  });

  it("keeps metadata fetches on the configured origin without redirects", async () => {
    const fetcher = new ExchangeMetadataFetcher(origin, async () => {
      const response = new Response("wrong origin");
      Object.defineProperty(response, "url", { value: "https://other.example/metadata" });
      return response;
    });
    await expect(fetcher.fetch(`${origin}/v1/tuf/metadata/timestamp.json`)).rejects.toThrow(
      /changed origin/,
    );
    await expect(
      fetcher.fetch("https://other.example/v1/tuf/metadata/timestamp.json"),
    ).rejects.toThrow(/escaped/);
  });

  it("classifies a fetch failure at the transport boundary", async () => {
    const fetcher = new ExchangeMetadataFetcher(origin, async () => {
      throw new TypeError("fetch failed");
    });
    await expect(fetcher.fetch(`${origin}/v1/tuf/metadata/timestamp.json`)).rejects.toBeInstanceOf(
      ExchangeTransportError,
    );
  });

  it("rejects metadata redirects as a trust failure, not an offline outage", async () => {
    const fetcher = new ExchangeMetadataFetcher(origin, async (_url, options) => {
      expect(options?.redirect).toBe("manual");
      return new Response(null, {
        status: 302,
        headers: { location: "https://other.example/metadata" },
      });
    });
    await expect(fetcher.fetch(`${origin}/v1/tuf/metadata/timestamp.json`)).rejects.toThrow(
      /redirects are forbidden/,
    );
  });

  it("resolves a signed target and rejects changed signed metadata", async () => {
    const source = fixture();
    const trusted = new TrustedExchange({
      origin,
      trustId: "official-test",
      initialRoot: source.rootBytes,
      stateRoot: temporaryDirectory(),
      fetcher: source.fetcher,
    });
    expect(await trusted.resolve("acme", "dashboard", "1.0.0")).toEqual({
      path: source.path,
      bytes: source.targetBytes.length,
      digest: source.digest,
    });
    const tampered = fixture();
    tampered.metadata["targets.json"] = Buffer.from("tampered metadata");
    const untrusted = new TrustedExchange({
      origin,
      trustId: "official-test",
      initialRoot: tampered.rootBytes,
      stateRoot: temporaryDirectory(),
      fetcher: tampered.fetcher,
    });
    await expect(untrusted.resolve("acme", "dashboard", "1.0.0")).rejects.toThrow();
  });

  it("removes a revoked target and rejects a signed metadata rollback", async () => {
    const source = fixture();
    const trusted = new TrustedExchange({
      origin,
      trustId: "official-test",
      initialRoot: source.rootBytes,
      stateRoot: temporaryDirectory(),
      fetcher: source.fetcher,
    });
    expect(await trusted.resolve("acme", "dashboard", "1.0.0")).not.toBeNull();
    source.publish(2, false);
    expect(await trusted.resolve("acme", "dashboard", "1.0.0")).toBeNull();
    source.publish(1, true);
    await expect(trusted.resolve("acme", "dashboard", "1.0.0")).rejects.toThrow();
  });

  it("rejects an expired signed timestamp", async () => {
    const source = fixture();
    source.publish(1, true, "2020-01-01T00:00:00Z");
    const trusted = new TrustedExchange({
      origin,
      trustId: "official-test",
      initialRoot: source.rootBytes,
      stateRoot: temporaryDirectory(),
      fetcher: source.fetcher,
    });
    await expect(trusted.resolve("acme", "dashboard", "1.0.0")).rejects.toThrow();
  });
});
