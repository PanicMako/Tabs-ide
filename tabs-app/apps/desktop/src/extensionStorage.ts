import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";
import type { TabsExtensionStorageMigration } from "@tabs/contracts";

const KEY = /^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/;
const MAX_VALUE_BYTES = 64 * 1024;
const MAX_DOCUMENT_BYTES = 1024 * 1024;
const MAX_NAMESPACE_BYTES = 16 * 1024 * 1024;
const MAX_NAMESPACE_FILES = 2_048;
const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

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
      if (entry.name === "rollback") {
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
    const namespace = this.namespaceHash(identity.extensionId);
    const parts =
      identity.projectId === undefined
        ? [identity.profileId]
        : [identity.profileId, identity.projectId];
    const hash = Crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
    return Path.join(this.root, "scoped", namespace, `${hash}.json`);
  }

  /** Called only after the user explicitly chooses to delete this extension's data. */
  removeNamespace(extensionId: string): void {
    const namespace = this.namespaceHash(extensionId);
    const scopedRoot = Path.join(this.root, "scoped");
    const directory = Path.join(scopedRoot, namespace);
    this.assertSafeDirectory(this.root);
    this.assertSafeDirectory(scopedRoot);
    let directoryStat: FS.Stats;
    try {
      directoryStat = FS.lstatSync(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error("Extension storage directory is invalid.");
    }
    for (const entry of FS.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json(?:\.[a-f0-9]{16}\.tmp)?$/.test(entry.name)) {
        throw new Error("Extension storage directory contains an unexpected entry.");
      }
    }
    FS.rmSync(directory, { recursive: true });
  }

  /** Persist an exact baseline before a package update can touch profile storage. */
  snapshotForUpdate(extensionId: string, digest: string): void {
    const backup = this.backupFile(extensionId, digest);
    if (FS.existsSync(backup)) {
      this.readBackup(backup);
      return;
    }
    const files = this.readNamespace(extensionId);
    const serialized = JSON.stringify({ version: 1, files });
    if (Buffer.byteLength(serialized) > MAX_BACKUP_BYTES) {
      throw new Error("Extension storage exceeds update backup limit.");
    }
    const rollbackRoot = Path.dirname(backup);
    this.assertSafeDirectory(this.root);
    this.assertSafeDirectory(rollbackRoot);
    FS.mkdirSync(rollbackRoot, { recursive: true, mode: 0o700 });
    this.assertSafeDirectory(rollbackRoot);
    this.writeAtomic(backup, serialized);
  }

  /** Idempotent recovery also handles crashes partway through a migration. */
  restoreUpdateSnapshot(extensionId: string, digest: string): void {
    const files = this.readBackup(this.backupFile(extensionId, digest));
    const directory = this.namespaceDirectory(extensionId);
    const current = this.readNamespace(extensionId);
    this.assertSafeDirectory(this.root);
    this.assertSafeDirectory(Path.dirname(directory));
    FS.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.assertSafeDirectory(directory);
    for (const [name, contents] of Object.entries(files)) {
      this.writeAtomic(Path.join(directory, name), contents);
    }
    for (const name of Object.keys(current)) {
      if (!Object.hasOwn(files, name)) FS.unlinkSync(Path.join(directory, name));
    }
  }

  applyVersionedMigrations(
    extensionId: string,
    fromVersion: number,
    toVersion: number,
    migrations: readonly TabsExtensionStorageMigration[],
  ): void {
    if (toVersion < fromVersion) throw new Error("Extension storage schema cannot downgrade.");
    if (toVersion === fromVersion) return;
    const files = this.readNamespace(extensionId);
    const transformed: Record<string, string> = {};
    for (const [name, contents] of Object.entries(files)) {
      let values = JSON.parse(contents) as Record<string, unknown>;
      for (let version = fromVersion; version < toVersion; version++) {
        const migration = migrations[version - 1];
        if (!migration || migration.from !== version || migration.to !== version + 1) {
          throw new Error(`Missing extension storage migration from version ${version}.`);
        }
        const next: Record<string, unknown> = { ...values };
        for (const rename of migration.renames) {
          if (!Object.hasOwn(values, rename.from)) continue;
          if (Object.hasOwn(values, rename.to)) {
            throw new Error(`Extension storage migration would overwrite ${rename.to}.`);
          }
          next[rename.to] = values[rename.from];
          delete next[rename.from];
        }
        values = next;
      }
      const serialized = JSON.stringify(values);
      if (Buffer.byteLength(serialized) > MAX_DOCUMENT_BYTES) {
        throw new Error("Migrated extension profile storage is too large.");
      }
      transformed[name] = serialized;
    }
    const directory = this.namespaceDirectory(extensionId);
    for (const [name, contents] of Object.entries(transformed)) {
      this.writeAtomic(Path.join(directory, name), contents);
    }
  }

  discardUpdateSnapshot(extensionId: string, digest: string): void {
    const backup = this.backupFile(extensionId, digest);
    this.assertSafeDirectory(this.root);
    this.assertSafeDirectory(Path.dirname(backup));
    try {
      const stat = FS.lstatSync(backup);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error("Invalid extension storage backup.");
      FS.unlinkSync(backup);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  /** Uninstall removes stale update baselines, even when profile data is retained. */
  discardAllUpdateSnapshots(extensionId: string): void {
    const directory = Path.join(this.root, "rollback");
    this.assertSafeDirectory(this.root);
    this.assertSafeDirectory(directory);
    if (!FS.existsSync(directory)) return;
    const prefix = `${this.namespaceHash(extensionId)}-`;
    for (const name of FS.readdirSync(directory)) {
      if (!name.startsWith(prefix)) continue;
      if (!new RegExp(`^${prefix}[a-f0-9]{64}\\.json(?:\\.[a-f0-9]{16}\\.tmp)?$`).test(name)) {
        throw new Error("Invalid extension storage backup filename.");
      }
      const path = Path.join(directory, name);
      const stat = FS.lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("Invalid extension storage backup.");
      }
      FS.unlinkSync(path);
    }
  }

  private namespaceHash(extensionId: string): string {
    return Crypto.createHash("sha256").update(extensionId).digest("hex");
  }

  private namespaceDirectory(extensionId: string): string {
    return Path.join(this.root, "scoped", this.namespaceHash(extensionId));
  }

  private backupFile(extensionId: string, digest: string): string {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid update backup identity.");
    return Path.join(this.root, "rollback", `${this.namespaceHash(extensionId)}-${digest}.json`);
  }

  private readNamespace(extensionId: string): Record<string, string> {
    const directory = this.namespaceDirectory(extensionId);
    this.assertSafeDirectory(this.root);
    this.assertSafeDirectory(Path.dirname(directory));
    this.assertSafeDirectory(directory);
    if (!FS.existsSync(directory)) return {};
    const names = FS.readdirSync(directory);
    if (names.length > MAX_NAMESPACE_FILES)
      throw new Error("Extension storage has too many profile files.");
    const files: Record<string, string> = {};
    let total = 0;
    for (const name of names) {
      if (/^[a-f0-9]{64}\.json\.[a-f0-9]{16}\.tmp$/.test(name)) {
        const temporary = Path.join(directory, name);
        const stat = FS.lstatSync(temporary);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new Error("Invalid extension storage temporary file.");
        }
        FS.unlinkSync(temporary);
        continue;
      }
      if (!/^[a-f0-9]{64}\.json$/.test(name))
        throw new Error("Invalid extension storage profile file.");
      const path = Path.join(directory, name);
      const stat = FS.lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_DOCUMENT_BYTES) {
        throw new Error("Invalid extension storage profile file.");
      }
      total += stat.size;
      if (total > MAX_NAMESPACE_BYTES)
        throw new Error("Extension storage exceeds update backup limit.");
      const contents = FS.readFileSync(path, "utf8");
      const value: unknown = JSON.parse(contents);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Invalid extension storage profile document.");
      }
      files[name] = contents;
    }
    return files;
  }

  private readBackup(path: string): Record<string, string> {
    this.assertSafeDirectory(this.root);
    this.assertSafeDirectory(Path.dirname(path));
    const stat = FS.lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BACKUP_BYTES) {
      throw new Error("Invalid extension storage backup.");
    }
    const parsed: unknown = JSON.parse(FS.readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid extension storage backup.");
    }
    const record = parsed as { version?: unknown; files?: unknown };
    if (
      record.version !== 1 ||
      !record.files ||
      typeof record.files !== "object" ||
      Array.isArray(record.files)
    ) {
      throw new Error("Invalid extension storage backup.");
    }
    const files = record.files as Record<string, unknown>;
    let total = 0;
    if (
      Object.keys(files).length > MAX_NAMESPACE_FILES ||
      Object.entries(files).some(([name, contents]) => {
        if (!/^[a-f0-9]{64}\.json$/.test(name) || typeof contents !== "string") return true;
        const bytes = Buffer.byteLength(contents);
        total += bytes;
        if (bytes > MAX_DOCUMENT_BYTES || total > MAX_NAMESPACE_BYTES) return true;
        try {
          const value: unknown = JSON.parse(contents);
          return !value || typeof value !== "object" || Array.isArray(value);
        } catch {
          return true;
        }
      })
    )
      throw new Error("Invalid extension storage backup.");
    return files as Record<string, string>;
  }

  private writeAtomic(path: string, contents: string): void {
    const temporary = `${path}.${Crypto.randomBytes(8).toString("hex")}.tmp`;
    try {
      FS.writeFileSync(temporary, contents, { flag: "wx", mode: 0o600 });
      FS.renameSync(temporary, path);
    } finally {
      if (FS.existsSync(temporary)) FS.unlinkSync(temporary);
    }
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
