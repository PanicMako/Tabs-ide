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
  readonly projectId?: string;
}

/** Non-secret, profile-scoped data. The caller must authorize the active view first. */
export class ExtensionStorage {
  constructor(private readonly root: string) {}

  /** Flat-hash files predate per-extension storage directories and cannot be inventoried. */
  hasLegacyFiles(): boolean {
    if (!FS.existsSync(this.root)) return false;
    if (FS.lstatSync(this.root).isSymbolicLink()) return true;
    for (const entry of FS.readdirSync(this.root, { withFileTypes: true })) {
      if (entry.name === "scoped") {
        if (!entry.isDirectory()) return true;
        continue;
      }
      if (!/^[a-f0-9]{2}$/.test(entry.name) || !entry.isDirectory()) return true;
      if (FS.readdirSync(Path.join(this.root, entry.name)).length > 0) return true;
    }
    return false;
  }

  invoke(
    identity: ExtensionStorageIdentity,
    operation: ExtensionStorageOperation,
    options: { readonly allowLegacy?: boolean } = {},
  ): unknown {
    if (!operation || !["get", "set", "delete"].includes(operation.kind)) {
      throw new Error("Invalid storage operation.");
    }
    if (typeof operation.key !== "string" || !KEY.test(operation.key)) {
      throw new Error("Invalid storage key.");
    }
    const filename = this.filename(identity);
    this.assertSafeDirectory(this.root);
    this.assertSafeDirectory(Path.join(this.root, "scoped"));
    this.assertSafeDirectory(Path.dirname(filename));
    const legacy = this.legacyFilename(identity);
    if (options.allowLegacy) this.assertSafeDirectory(Path.dirname(legacy));
    const values =
      options.allowLegacy && !FS.existsSync(filename) ? this.read(legacy) : this.read(filename);
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
    this.assertSafeDirectory(this.root);
    this.assertSafeDirectory(Path.join(this.root, "scoped"));
    this.assertSafeDirectory(Path.dirname(filename));
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
    const namespace = Crypto.createHash("sha256").update(identity.extensionId).digest("hex");
    const parts =
      identity.projectId === undefined
        ? [identity.profileId]
        : [identity.profileId, identity.projectId];
    const hash = Crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
    return Path.join(this.root, "scoped", namespace, `${hash}.json`);
  }

  /** Called only after the user explicitly chooses to delete this extension's data. */
  removeNamespace(extensionId: string): void {
    const namespace = Crypto.createHash("sha256").update(extensionId).digest("hex");
    const scopedRoot = Path.join(this.root, "scoped");
    const directory = Path.join(scopedRoot, namespace);
    if (!FS.existsSync(directory)) return;
    if (
      FS.lstatSync(this.root).isSymbolicLink() ||
      FS.lstatSync(scopedRoot).isSymbolicLink() ||
      FS.lstatSync(directory).isSymbolicLink()
    ) {
      throw new Error("Extension storage directory is a symbolic link.");
    }
    for (const entry of FS.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) {
        throw new Error("Extension storage directory contains an unexpected entry.");
      }
    }
    FS.rmSync(directory, { recursive: true });
  }

  /** Earlier experimental builds used a flat hash with no extension inventory. */
  private legacyFilename(identity: ExtensionStorageIdentity): string {
    const parts =
      identity.projectId === undefined
        ? [identity.extensionId, identity.profileId]
        : [identity.extensionId, identity.profileId, identity.projectId];
    const hash = Crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
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

  private assertSafeDirectory(directory: string): void {
    try {
      const stat = FS.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error("Extension storage directory is invalid.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
