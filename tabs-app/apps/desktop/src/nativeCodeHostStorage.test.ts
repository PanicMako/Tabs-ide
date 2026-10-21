import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createNativeCodeHostStorageService,
  loadNativeCodeHostStorage,
  saveNativeCodeHostStorage,
} from "./nativeCodeHostStorage";

const temporaryDirectories: string[] = [];

function createStoragePath(): string {
  const directory = mkdtempSync(Path.join(OS.tmpdir(), "tabs-native-code-storage-"));
  temporaryDirectories.push(directory);
  const nestedDirectory = Path.join(directory, "nested");
  mkdirSync(nestedDirectory);
  return Path.join(nestedDirectory, "storage.json");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("native code host storage", () => {
  it("round-trips extension state", () => {
    const storagePath = createStoragePath();
    saveNativeCodeHostStorage(
      storagePath,
      new Map([
        ["persisted-atom-state", "onboarding-complete"],
        ["another-key", "another-value"],
      ]),
    );

    expect(Array.from(loadNativeCodeHostStorage(storagePath))).toEqual([
      ["persisted-atom-state", "onboarding-complete"],
      ["another-key", "another-value"],
    ]);
  });

  it("returns empty storage for missing, malformed, or unsupported data", () => {
    const storagePath = createStoragePath();
    expect(loadNativeCodeHostStorage(storagePath).size).toBe(0);

    writeFileSync(storagePath, "not-json", "utf8");
    expect(loadNativeCodeHostStorage(storagePath).size).toBe(0);

    writeFileSync(storagePath, JSON.stringify({ version: 2, items: [] }), "utf8");
    expect(loadNativeCodeHostStorage(storagePath).size).toBe(0);
  });

  it("writes a versioned document without leaving its temporary file", () => {
    const storagePath = createStoragePath();
    saveNativeCodeHostStorage(storagePath, new Map([["key", "value"]]));

    expect(JSON.parse(readFileSync(storagePath, "utf8"))).toEqual({
      version: 1,
      items: [["key", "value"]],
    });
    expect(() => readFileSync(`${storagePath}.tmp`, "utf8")).toThrow();
  });
});

it("persists typed coordinator counters and impressions across restart", () => {
  const path = createStoragePath();
  const storage = new Map<string, string>();
  const service = createNativeCodeHostStorageService(storage, () =>
    saveNativeCodeHostStorage(path, storage),
  );
  service.store("count", 7, -1, 1);
  service.store("impression", { timestamp: 123, editorSessionCount: 7 }, -1, 1);
  const restarted = createNativeCodeHostStorageService(loadNativeCodeHostStorage(path), () => {});
  expect(restarted.getNumber("count", -1)).toBe(7);
  expect(restarted.getObject("impression", -1)).toEqual({ timestamp: 123, editorSessionCount: 7 });
  expect(restarted.getNumber("absent", -1)).toBeUndefined();
  service.store("count", undefined);
  expect(service.getNumber("count", -1, 0)).toBe(0);
});
