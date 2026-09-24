import * as FS from "node:fs";
import * as Crypto from "node:crypto";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExtensionStorage } from "./extensionStorage";

const roots: string[] = [];

function storage(): ExtensionStorage {
  const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-extension-storage-test-"));
  roots.push(root);
  return new ExtensionStorage(root);
}

afterEach(() => {
  for (const root of roots.splice(0)) FS.rmSync(root, { recursive: true, force: true });
});

describe("extension profile storage", () => {
  it("can remove one extension namespace without touching another", () => {
    const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-extension-storage-test-"));
    roots.push(root);
    const subject = new ExtensionStorage(root);
    const first = { extensionId: "registry-a-acme.dashboard", profileId: "work" };
    const second = { extensionId: "registry-b-acme.dashboard", profileId: "work" };
    subject.invoke(first, { kind: "set", key: "secret", value: "a" });
    subject.invoke(second, { kind: "set", key: "secret", value: "b" });
    subject.removeNamespace(first.extensionId);
    expect(subject.invoke(first, { kind: "get", key: "secret" })).toBeNull();
    expect(subject.invoke(second, { kind: "get", key: "secret" })).toBe("b");
  });

  it("rejects a storage-root symlink rather than writing outside Tabs data", () => {
    const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-extension-storage-test-"));
    roots.push(root);
    const outside = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-extension-storage-outside-"));
    roots.push(outside);
    FS.symlinkSync(outside, Path.join(root, "scoped"));
    const subject = new ExtensionStorage(root);
    expect(() =>
      subject.invoke(
        { extensionId: "acme.dashboard", profileId: "work" },
        { kind: "set", key: "value", value: "no" },
      ),
    ).toThrow(/directory is invalid/);
    expect(FS.readdirSync(outside)).toEqual([]);
  });

  it("reads legacy data only when explicitly enabled for an older installation", () => {
    const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-extension-storage-test-"));
    roots.push(root);
    const subject = new ExtensionStorage(root);
    expect(subject.hasLegacyFiles()).toBe(false);
    const identity = { extensionId: "acme.dashboard", profileId: "work" };
    const hash = Crypto.createHash("sha256")
      .update(JSON.stringify([identity.extensionId, identity.profileId]))
      .digest("hex");
    const legacy = Path.join(root, hash.slice(0, 2), `${hash}.json`);
    FS.mkdirSync(Path.dirname(legacy));
    FS.writeFileSync(legacy, JSON.stringify({ theme: "legacy" }));
    expect(subject.hasLegacyFiles()).toBe(true);
    expect(subject.invoke(identity, { kind: "get", key: "theme" })).toBeNull();
    expect(subject.invoke(identity, { kind: "get", key: "theme" }, { allowLegacy: true })).toBe(
      "legacy",
    );
    subject.invoke(identity, { kind: "set", key: "new", value: true }, { allowLegacy: true });
    expect(subject.invoke(identity, { kind: "get", key: "theme" })).toBe("legacy");
  });
  it("isolates extension and account profiles", () => {
    const subject = storage();
    const work = { extensionId: "acme.dashboard", profileId: "work" };
    const personal = { extensionId: "acme.dashboard", profileId: "personal" };
    subject.invoke(work, { kind: "set", key: "theme", value: "dark" });
    expect(subject.invoke(work, { kind: "get", key: "theme" })).toBe("dark");
    expect(subject.invoke(personal, { kind: "get", key: "theme" })).toBeNull();
    expect(
      subject.invoke(
        { extensionId: "other.dashboard", profileId: "work" },
        {
          kind: "get",
          key: "theme",
        },
      ),
    ).toBeNull();
    subject.invoke(work, { kind: "delete", key: "theme" });
    expect(subject.invoke(work, { kind: "get", key: "theme" })).toBeNull();
  });

  it("shares data only when no project scope is selected", () => {
    const subject = storage();
    const base = { extensionId: "acme.dashboard", profileId: "work" };
    subject.invoke(base, { kind: "set", key: "theme", value: "shared" });
    subject.invoke(
      { ...base, projectId: "project-a" },
      {
        kind: "set",
        key: "theme",
        value: "project-a",
      },
    );
    expect(subject.invoke(base, { kind: "get", key: "theme" })).toBe("shared");
    expect(subject.invoke({ ...base, projectId: "project-a" }, { kind: "get", key: "theme" })).toBe(
      "project-a",
    );
    expect(
      subject.invoke({ ...base, projectId: "project-b" }, { kind: "get", key: "theme" }),
    ).toBeNull();
  });

  it("rejects non-JSON values, oversized values, and invalid keys", () => {
    const subject = storage();
    const identity = { extensionId: "acme.dashboard", profileId: "work" };
    expect(() => subject.invoke(identity, { kind: "get", key: "../secret" })).toThrow();
    expect(subject.invoke(identity, { kind: "get", key: "toString" })).toBeNull();
    expect(() =>
      subject.invoke(identity, { kind: "set", key: "big", value: "x".repeat(70_000) }),
    ).toThrow();
    expect(() => subject.invoke(identity, { kind: "set", key: "bad", value: undefined })).toThrow();
  });
});
