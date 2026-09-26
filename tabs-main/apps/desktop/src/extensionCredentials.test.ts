import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExtensionCredentials, type CredentialCryptography } from "./extensionCredentials";

const roots: string[] = [];

function fixture(platform: NodeJS.Platform = "darwin", backend = "gnome_libsecret") {
  const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-extension-credentials-"));
  roots.push(root);
  const cryptography: CredentialCryptography = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => backend,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
  };
  const store = new ExtensionCredentials(Path.join(root, "secrets"), cryptography, platform);
  return { root, store };
}

afterEach(() => {
  for (const root of roots.splice(0)) FS.rmSync(root, { recursive: true, force: true });
});

describe("extension credentials", () => {
  it("stores ciphertext under extension, profile, project, and host identity", () => {
    const { root, store } = fixture();
    const shared = {
      extensionId: "exchange-abc-acme.tool",
      profileId: "work",
      host: "api.example.com",
    };
    const project = { ...shared, projectId: "project-a" };
    store.set(shared, "shared-secret");
    expect(() => store.set(shared, "secret\nX-Injected: yes")).toThrow(
      /Invalid extension credential value/,
    );
    store.set(project, "project-secret");
    expect(store.get(shared)).toBe("shared-secret");
    expect(store.get(project)).toBe("project-secret");
    expect(store.get({ ...shared, profileId: "personal" })).toBeNull();
    expect(store.get({ ...shared, host: "other.example.com" })).toBeNull();
    expect(store.get({ ...shared, extensionId: "exchange-def-acme.tool" })).toBeNull();
    const file = Path.join(root, "secrets", FS.readdirSync(Path.join(root, "secrets"))[0]!);
    const contents = FS.readFileSync(file, "utf8");
    expect(contents).not.toContain("shared-secret");
    expect(contents).not.toContain("project-secret");
    expect(store.list(shared.extensionId)).toEqual([shared, project]);
    store.delete(project);
    expect(store.get(project)).toBeNull();
    store.removeNamespace(shared.extensionId);
    expect(store.get(shared)).toBeNull();
  });

  it("refuses Linux's weak fallback and symbolic-link credential roots", () => {
    const { root, store } = fixture("linux", "basic_text");
    const identity = { extensionId: "acme.tool", profileId: "work", host: "api.example.com" };
    expect(() => store.set(identity, "secret")).toThrow(/OS-backed/);
    const target = Path.join(root, "target");
    FS.mkdirSync(target);
    FS.symlinkSync(target, Path.join(root, "secrets"));
    expect(() => store.list(identity.extensionId)).toThrow(/directory is invalid/);
  });

  it("refuses ciphertext relabeled for another approved host", () => {
    const { root, store } = fixture();
    const first = { extensionId: "acme.tool", profileId: "work", host: "api.example.com" };
    const second = { ...first, host: "other.example.com" };
    store.set(first, "first-token");
    store.set(second, "second-token");
    const file = Path.join(root, "secrets", FS.readdirSync(Path.join(root, "secrets"))[0]!);
    const records = JSON.parse(FS.readFileSync(file, "utf8")) as Array<{ ciphertext: string }>;
    records[0]!.ciphertext = records[1]!.ciphertext;
    FS.writeFileSync(file, JSON.stringify(records));
    expect(() => store.get(first)).toThrow(/identity mismatch/);
  });
});
