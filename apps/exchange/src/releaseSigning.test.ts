import { describe, expect, it } from "vitest";
import { Metadata, MetadataKind } from "@tufjs/models";
import {
  createSigningBackup,
  lockBackup,
  unlockBackup,
  signRelease,
  fingerprint,
  type ReleasePlan,
} from "../frontend/src/lib/releaseSigning";
const origin = "https://exchange.example";
describe("device-local signing", () => {
  it("restores an encrypted backup and produces four interoperable TUF signatures without changing the trust root", async () => {
    const backup = await createSigningBackup(origin);
    const encrypted = await lockBackup(backup, "a strong backup password");
    expect(encrypted).not.toContain(backup.keys.root.privateKey);
    const restored = await unlockBackup(encrypted, "a strong backup password", origin);
    const plan: ReleasePlan = {
      origin,
      root: backup.root,
      pin: await fingerprint(backup.root),
      versions: { root: 1, targets: 3, snapshot: 4, timestamp: 5 },
      targets: {
        "extensions/maker/tool/1.0.0.tabsext": { length: 10, hashes: { sha256: "a".repeat(64) } },
      },
    };
    const signed = await signRelease(plan, restored);
    const root = Metadata.fromJSON(MetadataKind.Root, JSON.parse(signed["root.json"]));
    root.verifyDelegate("root", root);
    root.verifyDelegate(
      "targets",
      Metadata.fromJSON(MetadataKind.Targets, JSON.parse(signed["targets.json"])),
    );
    root.verifyDelegate(
      "snapshot",
      Metadata.fromJSON(MetadataKind.Snapshot, JSON.parse(signed["snapshot.json"])),
    );
    root.verifyDelegate(
      "timestamp",
      Metadata.fromJSON(MetadataKind.Timestamp, JSON.parse(signed["timestamp.json"])),
    );
    expect(JSON.parse(signed["targets.json"]).signed.version).toBe(4);
    expect(JSON.parse(signed["snapshot.json"]).signed.meta["targets.json"].hashes.sha256).toBe(
      await fingerprint(signed["targets.json"]),
    );
    expect(JSON.parse(signed["timestamp.json"]).signed.meta["snapshot.json"].length).toBe(
      new TextEncoder().encode(signed["snapshot.json"]).length,
    );
    await expect(signRelease({ ...plan, pin: "b".repeat(64) }, backup)).rejects.toThrow(
      "trust root",
    );
  });
  it("rejects wrong passwords, wrong registries, tampered files and mismatched private keys", async () => {
    const backup = await createSigningBackup(origin),
      password = "a strong backup password";
    const encrypted = await lockBackup(backup, password);
    await expect(unlockBackup(encrypted, "incorrect password", origin)).rejects.toThrow(
      "Could not unlock",
    );
    await expect(unlockBackup(encrypted, password, "https://other.example")).rejects.toThrow(
      "Could not unlock",
    );
    await expect(
      unlockBackup(encrypted.replace('"iv":"', '"iv":"A'), password, origin),
    ).rejects.toThrow("Could not unlock");
    const another = await createSigningBackup(origin);
    backup.keys.targets.privateKey = another.keys.targets.privateKey;
    await expect(
      unlockBackup(await lockBackup(backup, password), password, origin),
    ).rejects.toThrow("Could not unlock");
  });
});
