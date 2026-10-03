import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as Path from "node:path";

type SerializedNativeCodeHostStorage = {
  version: 1;
  items: Array<[string, string]>;
};

function isStorageEntry(value: unknown): value is [string, string] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "string"
  );
}

export function loadNativeCodeHostStorage(storagePath: string): Map<string, string> {
  try {
    const value: unknown = JSON.parse(readFileSync(storagePath, "utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      !("version" in value) ||
      value.version !== 1 ||
      !("items" in value) ||
      !Array.isArray(value.items) ||
      !value.items.every(isStorageEntry)
    ) {
      return new Map();
    }
    return new Map(value.items);
  } catch {
    return new Map();
  }
}

export function saveNativeCodeHostStorage(
  storagePath: string,
  storage: ReadonlyMap<string, string>,
): void {
  mkdirSync(Path.dirname(storagePath), { recursive: true });
  const temporaryPath = `${storagePath}.tmp`;
  const value: SerializedNativeCodeHostStorage = {
    version: 1,
    items: Array.from(storage.entries()),
  };
  writeFileSync(temporaryPath, JSON.stringify(value), "utf8");
  renameSync(temporaryPath, storagePath);
}
