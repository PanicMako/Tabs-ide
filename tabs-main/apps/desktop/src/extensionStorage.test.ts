import * as FS from "node:fs";
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
