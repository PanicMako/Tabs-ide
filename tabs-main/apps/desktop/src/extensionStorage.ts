import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";

const KEY = /^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/;
const MAX_VALUE_BYTES = 64 * 1024;
const MAX_DOCUMENT_BYTES = 1024 * 1024;

export type ExtensionStorageOperation =
  | { readonly kind: "get"; readonly key: string }
  | { readonly kind: "set"; readonly key: string; readonly value: unknown }
  | { readonly kind: "delete"; readonly key: string };

export interface ExtensionStorageIdentity {
  readonly extensionId: string;
  readonly profileId: string;
}

/** Non-secret, profile-scoped data. The caller must authorize the active view first. */
export class ExtensionStorage {
  constructor(private readonly root: string) {}

  invoke(identity: ExtensionStorageIdentity, operation: ExtensionStorageOperation): unknown {
    if (!operation || !["get", "set", "delete"].includes(operation.kind)) {
      throw new Error("Invalid storage operation.");
    }
    if (typeof operation.key !== "string" || !KEY.test(operation.key)) {
      throw new Error("Invalid storage key.");
    }
    const filename = this.filename(identity);
    const values = this.read(filename);
    if (operation.kind === "get") {
      return Object.hasOwn(values, operation.key) ? values[operation.key] : null;
    }
    if (operation.kind === "set") {
      const serialized = JSON.stringify(operation.value);
      if (serialized === undefined || Buffer.byteLength(serialized) > MAX_VALUE_BYTES) {
        throw new Error("Storage value is too large or is not JSON data.");
      }
      values[operation.key] = JSON.parse(serialized) as unknown;
    } else {
      delete values[operation.key];
    }
    const serialized = JSON.stringify(values);
    if (Buffer.byteLength(serialized) > MAX_DOCUMENT_BYTES) {
      throw new Error("Extension profile storage is full.");
    }
    FS.mkdirSync(Path.dirname(filename), { recursive: true });
    const temporary = `${filename}.${Crypto.randomBytes(8).toString("hex")}.tmp`;
    try {
      FS.writeFileSync(temporary, serialized, { flag: "wx", mode: 0o600 });
      FS.renameSync(temporary, filename);
    } finally {
      if (FS.existsSync(temporary)) FS.unlinkSync(temporary);
    }
    return null;
  }

  private filename(identity: ExtensionStorageIdentity): string {
    const hash = Crypto.createHash("sha256")
      .update(JSON.stringify([identity.extensionId, identity.profileId]))
      .digest("hex");
    return Path.join(this.root, hash.slice(0, 2), `${hash}.json`);
  }

  private read(filename: string): Record<string, unknown> {
    try {
      const stat = FS.lstatSync(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_DOCUMENT_BYTES) {
        throw new Error("Extension storage file is invalid.");
      }
      const value: unknown = JSON.parse(FS.readFileSync(filename, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Extension storage file is invalid.");
      }
      return value as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }
}
