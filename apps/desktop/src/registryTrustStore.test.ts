import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { Key, Metadata, Root, Signature } from "@tufjs/models";
import { afterEach, describe, expect, it } from "vitest";
import { RegistryTrustStore, type RegistryTrustInput } from "./registryTrustStore";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    FS.rmSync(directory, { recursive: true, force: true });
});
function store() {
  const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-public-trust-"));
  directories.push(directory);
  return { directory, value: new RegistryTrustStore(directory) };
}
function fixture(expires = "2035-01-01T00:00:00Z"): RegistryTrustInput {
  const { privateKey, publicKey } = Crypto.generateKeyPairSync("ed25519");
  const bytes = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const keyID = Crypto.createHash("sha256").update(bytes).digest("hex");
  const key = new Key({
    keyID,
    keyType: "ed25519",
    scheme: "ed25519",
    keyVal: { public: bytes.toString("hex") },
  });
  const signed = new Root({ version: 1, specVersion: "1.0.0", expires, consistentSnapshot: false });
  for (const role of ["root", "targets", "snapshot", "timestamp"]) signed.addKey(key, role);
  const metadata = new Metadata(signed);
  metadata.sign(
    (data) => new Signature({ keyID, sig: Crypto.sign(null, data, privateKey).toString("hex") }),
  );
  const root = JSON.stringify(metadata.toJSON());
  return {
    origin: "https://exchange.example",
    confirmOrigin: "https://exchange.example",
    root,
    rootSha256: Crypto.createHash("sha256").update(root).digest("hex"),
    trustId: "registry-test",
  };
}
function withRoot(input: RegistryTrustInput, root: string): RegistryTrustInput {
  return { ...input, root, rootSha256: Crypto.createHash("sha256").update(root).digest("hex") };
}
describe("packaged desktop public registry connection", () => {
  it("persists a confirmed public root across restarts and scopes it to its exact origin", () => {
    const { directory, value } = store();
    const input = fixture();
    expect(value.read()).toBeNull();
    value.save(input);
    const restarted = new RegistryTrustStore(directory);
    expect(restarted.configuration(input.origin)).toEqual({
      origin: input.origin,
      trustId: input.trustId,
      root: Buffer.from(input.root),
    });
    expect(restarted.configuration("https://other.example")).toBeNull();
    expect(FS.statSync(Path.join(directory, "connection.json")).mode & 0o777).toBe(0o600);
    value.save(input);
  });
  it("rejects mismatched pins, non-origin URLs, and missing explicit confirmation", () => {
    const { value } = store();
    const input = fixture();
    expect(() => value.save({ ...input, rootSha256: "0".repeat(64) })).toThrow(/fingerprint/);
    for (const origin of [
      "http://exchange.example",
      "https://exchange.example/path",
      "https://user@exchange.example",
    ]) {
      expect(() => value.save({ ...input, origin, confirmOrigin: origin })).toThrow(/HTTPS/);
    }
    expect(() => value.save({ ...input, confirmOrigin: "" })).toThrow(/Confirm/);
    expect(value.read()).toBeNull();
  });
  it("does not let guided setup reset an existing registry's trust identity", () => {
    const { value } = store();
    const input = fixture();
    value.save(input);
    expect(() => value.save(fixture())).toThrow(/pinned identity/);
    expect(() => value.save({ ...input, trustId: "new-lineage" })).toThrow(/pinned identity/);
    expect(value.read()?.rootSha256).toBe(input.rootSha256);
  });
  it("rejects expired, unsigned, and private-key-containing metadata", () => {
    const { value } = store();
    expect(() => value.save(fixture("2020-01-01T00:00:00Z"))).toThrow(/expired/);
    const input = fixture();
    const json = JSON.parse(input.root);
    json.signatures = [];
    expect(() => value.save(withRoot(input, JSON.stringify(json)))).toThrow(/unsigned/);
    const privateJson = { ...JSON.parse(input.root), privateKey: "must never be saved" };
    expect(() => value.save(withRoot(input, JSON.stringify(privateJson)))).toThrow(/invalid/);
    expect(value.read()).toBeNull();
  });
  it("fails closed on corrupt or symlinked persisted state", () => {
    const { directory, value } = store();
    const file = Path.join(directory, "connection.json");
    FS.writeFileSync(file, "invalid json");
    expect(() => value.read()).toThrow();
    FS.unlinkSync(file);
    const target = Path.join(directory, "other.json");
    FS.writeFileSync(target, "{}");
    FS.symlinkSync(target, file);
    expect(() => value.read()).toThrow(/invalid/);
  });
});
