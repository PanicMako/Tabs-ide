import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCodeHostIdentity } from "./codeHostIdentity";
import { loadNativeCodeHostStorage, saveNativeCodeHostStorage } from "./nativeCodeHostStorage";

const directories: string[] = [];
function createStateDir() {
  const directory = mkdtempSync(Path.join(OS.tmpdir(), "tabs-code-identity-"));
  directories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("Code-OSS update identity continuity", () => {
  it("adopts the existing identity and retains it after runtime relocation and restart", () => {
    const stateDir = createStateDir();
    const previousRuntime = "/runtime/1.3.34/tabs-code-oss";
    const identity = resolveCodeHostIdentity(stateDir, previousRuntime);
    expect(identity.machineId).toBe(
      createHash("sha256").update(`machine:${previousRuntime}`).digest("hex"),
    );
    const storagePath = Path.join(
      stateDir,
      "code-oss-desktop",
      "shared-profile",
      "default",
      "globalStorage",
      "storage.json",
    );
    const extensionState = new Map([
      ["coderabbit.coderabbit-vscode", '{"onboardingComplete":true}'],
      ["secret://test-extension", "opaque-encrypted-test-value"],
    ]);
    saveNativeCodeHostStorage(storagePath, extensionState);
    expect(resolveCodeHostIdentity(stateDir, "/runtime/2.0.0/tabs-code-oss")).toEqual(identity);
    expect(
      resolveCodeHostIdentity(stateDir, "/Applications/Tabs.app/Contents/Resources/tabs-code-oss"),
    ).toEqual(identity);
    expect(loadNativeCodeHostStorage(storagePath)).toEqual(extensionState);
  });

  it("keeps existing identities in independent user profiles separate", () => {
    expect(resolveCodeHostIdentity(createStateDir(), "/runtime/old")).not.toEqual(
      resolveCodeHostIdentity(createStateDir(), "/runtime/new"),
    );
  });

  it("fails without overwriting a malformed saved identity", () => {
    const stateDir = createStateDir();
    resolveCodeHostIdentity(stateDir, "/runtime/old");
    const filename = Path.join(stateDir, "code-oss-desktop", "machine-identity.json");
    writeFileSync(filename, "invalid-json");
    expect(() => resolveCodeHostIdentity(stateDir, "/runtime/new")).toThrow();
    expect(readFileSync(filename, "utf8")).toBe("invalid-json");
  });
});
