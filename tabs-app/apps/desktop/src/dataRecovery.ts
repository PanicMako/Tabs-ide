import * as FS from "node:fs";
import * as Path from "node:path";
import * as OS from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { compareSemverVersions, parseSemver } from "@tabs/shared/semver";

export interface DataBackupSummary {
  id: string;
  version: string;
  createdAt: string;
  reason: string;
  bytes: number;
}
interface Entry {
  path: string;
  mode: number;
  size?: number;
  hash?: string;
  link?: string;
  /** Source stat identity (inode, size, mtime and ctime in ns) when the hash
   * was taken. Lets the next snapshot reuse the hash of an unchanged file.
   * Not part of the snapshot's content: comparisons ignore it. */
  stamp?: string;
}
/** Hashes from an earlier snapshot, keyed by relative path. */
type KnownHashes = ReadonlyMap<string, { stamp: string; hash: string }>;
/**
 * Format 1 stores a full copy of every root inside the snapshot directory.
 * Format 2 stores each distinct file content once in the shared object store
 * (`objects/<aa>/<sha256>`), so a snapshot of mostly unchanged data only stats
 * files and writes a manifest. Both formats stay readable and restorable.
 */
interface Backup extends DataBackupSummary {
  format: 1 | 2;
  createdByVersion: string;
  roots: Array<{ source: string; present: boolean; entries: Entry[] }>;
}
/** Small sidecar so listing snapshots never parses every multi-MB manifest. */
interface BackupListing extends DataBackupSummary {
  sources: string[];
}
const HASH = /^[0-9a-f]{64}$/;
const OBJECT_TEMP_PREFIX = "tmp-";
interface RestoreOperation {
  source: string;
  stage: string;
  previous: string;
  present: boolean;
  existed: boolean;
}
const ID = /^[0-9a-f-]{36}$/;
const VOLATILE = new Set([
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket",
  "DevToolsActivePort",
]);

function within(child: string, parent: string): boolean {
  const relative = Path.relative(parent, child);
  return (
    relative === "" ||
    (!Path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${Path.sep}`))
  );
}
function canonical(path: string): string {
  const absolute = Path.resolve(path);
  if (FS.existsSync(absolute)) return FS.realpathSync(absolute);
  return Path.join(canonical(Path.dirname(absolute)), Path.basename(absolute));
}
function syncDirectory(path: string): void {
  // Windows does not expose directory fsync through Node. File flushes and the
  // restore journal still protect interrupted-process recovery there.
  if (process.platform === "win32") return;
  const fd = FS.openSync(path, "r");
  try {
    FS.fsyncSync(fd);
  } finally {
    FS.closeSync(fd);
  }
}
function move(from: string, to: string): void {
  FS.renameSync(from, to);
  syncDirectory(Path.dirname(from));
  if (Path.dirname(from) !== Path.dirname(to)) syncDirectory(Path.dirname(to));
}
function writeJson(path: string, value: unknown): void {
  const content = JSON.stringify(value);
  if (Buffer.byteLength(content) > 64 * 1024 * 1024)
    throw new Error("Backup metadata exceeds the supported size; no snapshot was published.");
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = FS.openSync(temporary, "wx", 0o600);
  try {
    FS.writeFileSync(fd, content);
    FS.fsyncSync(fd);
  } finally {
    FS.closeSync(fd);
  }
  move(temporary, path);
}
function hashFile(path: string): string {
  const hash = createHash("sha256");
  const fd = FS.openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let size: number;
    while ((size = FS.readSync(fd, buffer, 0, buffer.length, null)) > 0)
      hash.update(buffer.subarray(0, size));
  } finally {
    FS.closeSync(fd);
  }
  return hash.digest("hex");
}
function excluded(relative: string): boolean {
  const normalized = relative.split(Path.sep).join("/");
  const cache = "(?:Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|logs)";
  return (
    VOLATILE.has(Path.basename(relative)) ||
    new RegExp(`^${cache}(?:/|$)`).test(normalized) ||
    new RegExp(`^(?:Partitions/[^/]+|code-oss-desktop/[^/]+|code-oss-main)/${cache}(?:/|$)`).test(
      normalized,
    ) ||
    [
      "node-compile-cache",
      "desktop-dev.log",
      "code-host-manager.log",
      // Code's own download cache of extension packages; Code re-fetches it.
      "code-oss-desktop/shared-process/CachedExtensionVSIXs",
    ].some((name) => normalized === name || normalized.startsWith(`${name}/`))
  );
}
function removeInternalTree(path: string): void {
  if (!FS.existsSync(path)) return;
  const makeWritable = (directory: string): void => {
    const stat = FS.lstatSync(directory);
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      FS.chmodSync(directory, stat.mode | 0o600);
      return;
    }
    if (!stat.isDirectory()) return;
    FS.chmodSync(directory, stat.mode | 0o700);
    for (const name of FS.readdirSync(directory)) makeWritable(Path.join(directory, name));
  };
  makeWritable(path);
  FS.rmSync(path, { recursive: true, force: true });
}
/** Only durable filesystem entries belong in a snapshot. Runtime endpoints can
 * have any name and may disappear between listing a directory and inspecting it. */
function backupStat(path: string): FS.Stats | null {
  let stat: FS.Stats;
  try {
    stat = FS.lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (stat.isSocket() || stat.isFIFO()) return null;
  if (!stat.isSymbolicLink() && !stat.isDirectory() && !stat.isFile())
    throw new Error(
      `Cannot back up an unsupported file: ${path}. Move this device entry outside Tabs data and retry.`,
    );
  return stat;
}

function fileStamp(path: string): string {
  const stat = FS.lstatSync(path, { bigint: true });
  return `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

/** `known` lets an unchanged file (same inode, size, mtime and ctime) reuse the
 * hash recorded by the previous snapshot instead of being read again. */
function inventory(root: string, known?: KnownHashes): Entry[] {
  if (FS.lstatSync(root).isSymbolicLink() || !FS.statSync(root).isDirectory())
    throw new Error("Backup root must be a real directory.");
  const entries: Entry[] = [];
  const walk = (directory: string): void => {
    for (const name of FS.readdirSync(directory).sort()) {
      const path = Path.join(directory, name);
      const relative = Path.relative(root, path);
      if (excluded(relative)) continue;
      const stat = backupStat(path);
      if (!stat) continue;
      if (entries.length >= 250_000) throw new Error("Backup contains too many files.");
      let file: Pick<Entry, "size" | "hash" | "stamp"> = {};
      if (stat.isFile()) {
        const stamp = fileStamp(path);
        const previous = known?.get(relative);
        file = {
          size: stat.size,
          hash: previous?.stamp === stamp ? previous.hash : hashFile(path),
          stamp,
        };
      }
      entries.push({
        path: relative,
        mode: stat.mode & 0o777,
        ...file,
        ...(stat.isSymbolicLink() ? { link: FS.readlinkSync(path) } : {}),
      });
      if (stat.isDirectory()) walk(path);
    }
  };
  walk(root);
  return entries;
}

function stampedHashes(entries: readonly Entry[]): KnownHashes {
  const hashes = new Map<string, { stamp: string; hash: string }>();
  for (const entry of entries) {
    if (typeof entry.stamp === "string" && typeof entry.hash === "string")
      hashes.set(entry.path, { stamp: entry.stamp, hash: entry.hash });
  }
  return hashes;
}

/** Content identity of a tree: stamps describe where a hash came from, not
 * what was saved, so a verified copy matches its source without them. */
function sameContent(left: readonly Entry[], right: readonly Entry[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index]!;
    return (
      entry.path === other.path &&
      entry.mode === other.mode &&
      entry.size === other.size &&
      entry.hash === other.hash &&
      entry.link === other.link
    );
  });
}

function isDirectoryEntry(entry: Entry): boolean {
  return entry.size === undefined && entry.hash === undefined && entry.link === undefined;
}

/** A manifest drives where restore writes, so every path must stay inside its
 * root and every parent must be a directory the manifest itself creates (a
 * restored symbolic link can never be used to write outside the root). */
function assertRestorableEntries(entries: readonly Entry[]): void {
  const directories = new Set<string>([""]);
  for (const entry of entries) {
    const path = entry.path;
    if (
      typeof path !== "string" ||
      path === "" ||
      Path.isAbsolute(path) ||
      Path.normalize(path) !== path ||
      path.split(Path.sep).some((part) => part === ".." || part === ".") ||
      !directories.has(Path.dirname(path) === "." ? "" : Path.dirname(path)) ||
      !Number.isInteger(entry.mode) ||
      entry.mode < 0 ||
      entry.mode > 0o777
    )
      throw new Error("Invalid backup entry; saved data was left untouched.");
    if (entry.hash !== undefined) {
      if (!HASH.test(entry.hash) || !Number.isSafeInteger(entry.size) || entry.link !== undefined)
        throw new Error("Invalid backup entry; saved data was left untouched.");
    } else if (entry.link !== undefined) {
      if (typeof entry.link !== "string" || entry.size !== undefined)
        throw new Error("Invalid backup entry; saved data was left untouched.");
    } else if (isDirectoryEntry(entry)) directories.add(path);
    else throw new Error("Invalid backup entry; saved data was left untouched.");
  }
}

/** Rebuilds a format 2 root from the object store. Entries are in walk order,
 * so parents always precede their children. */
function materialize(
  entries: readonly Entry[],
  objectPath: (hash: string) => string,
  destination: string,
): void {
  assertRestorableEntries(entries);
  FS.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const directories: Entry[] = [];
  for (const entry of entries) {
    const target = Path.join(destination, entry.path);
    if (entry.hash !== undefined) {
      FS.copyFileSync(objectPath(entry.hash), target, FS.constants.COPYFILE_FICLONE);
      FS.chmodSync(target, entry.mode | 0o600);
      const fd = FS.openSync(target, "r+");
      try {
        FS.chmodSync(target, entry.mode);
        FS.fsyncSync(fd);
      } finally {
        FS.closeSync(fd);
      }
    } else if (entry.link !== undefined) FS.symlinkSync(entry.link, target);
    else {
      FS.mkdirSync(target, { mode: 0o700 });
      directories.push(entry);
    }
  }
  // Children first, so read-only directory modes are applied after their contents.
  for (const entry of directories.reverse()) {
    const target = Path.join(destination, entry.path);
    syncDirectory(target);
    FS.chmodSync(target, entry.mode);
  }
  syncDirectory(destination);
}

/**
 * `durable` flushes every copied file and directory to stable storage before
 * returning. Restores need that because the copy replaces live data. Snapshots
 * do not: on macOS each flush is an F_FULLFSYNC drive-cache flush (~4 ms), so
 * flushing a 28k-file snapshot took about two minutes on the main thread before
 * the first window. A snapshot is instead published atomically after its
 * manifest is flushed, and its content is re-hashed by `verify()` before any
 * restore uses it, so an interrupted write can never reach live data.
 */
function copyTree(source: string, destination: string, durable: boolean, prefix = ""): void {
  FS.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const name of FS.readdirSync(source)) {
    const relative = Path.join(prefix, name);
    if (excluded(relative)) continue;
    const from = Path.join(source, name);
    const to = Path.join(destination, name);
    const stat = backupStat(from);
    if (!stat) continue;
    if (stat.isDirectory()) {
      copyTree(from, to, durable, relative);
      FS.chmodSync(to, stat.mode & 0o777);
    } else if (stat.isFile()) {
      FS.copyFileSync(from, to, FS.constants.COPYFILE_FICLONE);
      if (!durable) {
        FS.chmodSync(to, stat.mode & 0o777);
        continue;
      }
      FS.chmodSync(to, (stat.mode & 0o777) | 0o600);
      const fd = FS.openSync(to, "r+");
      try {
        FS.chmodSync(to, stat.mode & 0o777);
        FS.fsyncSync(fd);
      } finally {
        FS.closeSync(fd);
      }
    } else if (stat.isSymbolicLink()) {
      // Preserve the link itself; never read or recursively copy its target.
      FS.symlinkSync(FS.readlinkSync(from), to);
    } else throw new Error(`Cannot back up a special file: ${from}`);
  }
  if (durable) syncDirectory(destination);
}

/** Call startup/restore only while the desktop owns its single-instance lock,
 * before opening Chromium sessions, SQLite, Code, or extension managers. */
export class DataRecovery {
  readonly roots: readonly string[];
  private locks: DatabaseSync[] = [];
  constructor(
    readonly directory: string,
    roots: readonly string[],
    readonly version: string,
    private readonly freeDiskBytes: (directory: string) => number = (directory) => {
      const space = FS.statfsSync(directory);
      return space.bavail * space.bsize;
    },
    /**
     * Flush each newly stored object. macOS implements every flush as an
     * F_FULLFSYNC drive-cache flush (~4 ms each), and APFS clones there carry no
     * data writes of their own, so it relies on the manifest flush instead.
     */
    private readonly flushEachObject: boolean = process.platform !== "darwin",
  ) {
    const candidates = [...new Set(roots.map(canonical))];
    this.roots = candidates
      .filter((root) => !candidates.some((other) => other !== root && within(root, other)))
      .sort();
    const backup = canonical(directory);
    for (const root of this.roots) {
      if (
        root === Path.parse(root).root ||
        root === canonical(OS.homedir()) ||
        within(backup, root) ||
        within(root, backup)
      )
        throw new Error("Backup storage must be separate from application data.");
    }
    FS.mkdirSync(directory, { recursive: true, mode: 0o700 });
    FS.chmodSync(directory, 0o700);
  }

  acquireLocks(): void {
    try {
      for (const root of this.roots) {
        FS.mkdirSync(Path.dirname(root), { recursive: true });
        const path = Path.join(
          Path.dirname(root),
          `.tabs-data-owner-${createHash("sha256").update(root).digest("hex").slice(0, 16)}.sqlite`,
        );
        if (
          FS.existsSync(path) &&
          (FS.lstatSync(path).isSymbolicLink() || !FS.statSync(path).isFile())
        )
          throw new Error("Invalid application data lock.");
        const database = new DatabaseSync(path);
        try {
          FS.chmodSync(path, 0o600);
          database.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;");
          this.locks.push(database);
        } catch (error) {
          database.close();
          throw error;
        }
      }
    } catch {
      this.releaseLocks();
      throw new Error(
        "Another Tabs session is using this data, or its data lock is unavailable. Close the other session before backing up or recovering.",
      );
    }
  }

  releaseLocks(): void {
    for (const database of this.locks.splice(0)) database.close();
  }

  list(): DataBackupSummary[] {
    return FS.readdirSync(this.directory)
      .filter((id) => ID.test(id))
      .flatMap((id) => {
        try {
          return [this.listing(id)];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Reads the snapshot's sidecar summary; a snapshot without one (or with a
   * damaged one) is read in full once and gets a summary for later launches. */
  private listing(id: string): DataBackupSummary {
    if (!ID.test(id)) throw new Error("Invalid backup identifier.");
    const path = Path.join(this.directory, id, "summary.json");
    try {
      if (!FS.lstatSync(path).isFile()) throw new Error("Invalid backup summary.");
      const value = JSON.parse(FS.readFileSync(path, "utf8")) as BackupListing;
      if (
        value.id === id &&
        typeof value.version === "string" &&
        typeof value.reason === "string" &&
        typeof value.createdAt === "string" &&
        Number.isFinite(Date.parse(value.createdAt)) &&
        Number.isFinite(value.bytes) &&
        value.bytes >= 0 &&
        Array.isArray(value.sources) &&
        JSON.stringify(value.sources) === JSON.stringify(this.roots)
      ) {
        const { id: _, version, createdAt, reason, bytes } = value;
        return { id, version, createdAt, reason, bytes };
      }
    } catch {
      /* Fall back to the manifest. */
    }
    const backup = this.read(id);
    const summary: DataBackupSummary = {
      id,
      version: backup.version,
      createdAt: backup.createdAt,
      reason: backup.reason,
      bytes: backup.bytes,
    };
    try {
      this.writeListing(Path.join(this.directory, id), summary);
    } catch {
      /* A read-only snapshot is still listed from its manifest. */
    }
    return summary;
  }

  private writeListing(directory: string, summary: DataBackupSummary): void {
    const listing: BackupListing = { ...summary, sources: [...this.roots] };
    writeJson(Path.join(directory, "summary.json"), listing);
  }

  private get objectsDirectory(): string {
    return Path.join(this.directory, "objects");
  }

  private objectPath(hash: string): string {
    if (!HASH.test(hash)) throw new Error("Invalid backup object.");
    return Path.join(this.objectsDirectory, hash.slice(0, 2), hash);
  }

  private hasObject(hash: string): boolean {
    try {
      const stat = FS.lstatSync(this.objectPath(hash));
      return stat.isFile();
    } catch {
      return false;
    }
  }

  /** Clones `source` into the object store under the hash recorded for it.
   * The clone is hashed, so a file that changed after it was inventoried is
   * refused instead of stored under the wrong name. */
  private storeObject(source: string, hash: string): void {
    const target = this.objectPath(hash);
    const directory = Path.dirname(target);
    FS.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = Path.join(directory, `${OBJECT_TEMP_PREFIX}${randomUUID()}`);
    try {
      FS.copyFileSync(source, temporary, FS.constants.COPYFILE_FICLONE);
      if (hashFile(temporary) !== hash)
        throw new Error("Backup changed while being copied; no complete snapshot was published.");
      if (this.flushEachObject) {
        const fd = FS.openSync(temporary, "r+");
        try {
          FS.fsyncSync(fd);
        } finally {
          FS.closeSync(fd);
        }
      }
      FS.chmodSync(temporary, 0o400);
      FS.renameSync(temporary, target);
      if (this.flushEachObject) syncDirectory(directory);
    } catch (error) {
      FS.rmSync(temporary, { force: true });
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error("Backup changed while being copied; no complete snapshot was published.");
      throw error;
    }
  }

  get ownsStores(): boolean {
    return this.locks.length === this.roots.length;
  }

  private assertBackendStopped(): void {
    for (const root of this.roots) {
      const path = Path.join(root, "server-runtime.json");
      if (!FS.existsSync(path)) continue;
      let pid: unknown;
      try {
        pid = JSON.parse(FS.readFileSync(path, "utf8")).pid;
      } catch {
        continue;
      }
      if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) continue;
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") continue;
        throw new Error("Cannot verify whether the workspace server has stopped.");
      }
      throw new Error(
        `A workspace server is still using this store (pid ${pid}). Stop it before backing up or recovering.`,
      );
    }
  }

  create(reason: string, version = this.version): DataBackupSummary {
    this.assertBackendStopped();
    const id = randomUUID();
    const stage = Path.join(this.directory, `${id}.partial`);
    FS.mkdirSync(stage, { mode: 0o700 });
    // Objects first stored by this attempt; nothing else can reference them.
    const stored: string[] = [];
    try {
      // The newest snapshot's stamps let unchanged files skip hashing entirely.
      const known = this.knownHashes();
      const roots = this.roots.map((source) => {
        if (FS.existsSync(source) && !FS.statSync(source).isDirectory())
          throw new Error(`Backup root is not a directory: ${source}`);
        return {
          source,
          present: FS.existsSync(source),
          entries: FS.existsSync(source) ? inventory(source, known.get(source)) : [],
        };
      });
      const bytes = roots
        .flatMap((root) => root.entries)
        .reduce((sum, entry) => sum + (entry.size ?? 0), 0);
      // Only content the store does not already hold is copied.
      const missing = new Map<string, string>();
      let missingBytes = 0;
      for (const root of roots) {
        for (const entry of root.entries) {
          if (entry.hash === undefined || missing.has(entry.hash) || this.hasObject(entry.hash))
            continue;
          missing.set(entry.hash, Path.join(root.source, entry.path));
          missingBytes += entry.size ?? 0;
        }
      }
      if (this.freeDiskBytes(this.directory) < missingBytes + 64 * 1024 * 1024)
        throw new Error(
          "Not enough free space for a verified data backup. Free disk space and restart Tabs.",
        );
      for (const [hash, source] of missing) {
        // Recorded first so a failed copy's empty prefix directory is pruned too.
        stored.push(hash);
        this.storeObject(source, hash);
      }
      // Every file must still be exactly what was inventoried, including files
      // whose content was already stored, or the snapshot is not one moment.
      for (const root of roots) {
        for (const entry of root.entries) {
          if (entry.stamp === undefined) continue;
          let current: string | null;
          try {
            current = fileStamp(Path.join(root.source, entry.path));
          } catch {
            current = null;
          }
          if (current !== entry.stamp)
            throw new Error(
              "Backup changed while being copied; no complete snapshot was published.",
            );
        }
      }
      const backup: Backup = {
        format: 2,
        createdByVersion: this.version,
        id,
        version,
        createdAt: new Date().toISOString(),
        reason,
        bytes,
        roots,
      };
      const summary = { id, version, createdAt: backup.createdAt, reason, bytes };
      writeJson(Path.join(stage, "manifest.json"), backup);
      this.writeListing(stage, summary);
      move(stage, Path.join(this.directory, id));
      return summary;
    } catch (error) {
      removeInternalTree(stage);
      this.discardObjects(stored);
      throw error;
    }
  }

  /** Per-root hashes from the newest readable snapshot. Unreadable or older
   * stamp-less manifests simply mean every file is hashed again. */
  private knownHashes(): Map<string, KnownHashes> {
    const known = new Map<string, KnownHashes>();
    const latest = this.list()[0];
    if (!latest) return known;
    try {
      for (const root of this.read(latest.id).roots) {
        if (Array.isArray(root.entries)) known.set(root.source, stampedHashes(root.entries));
      }
    } catch {
      known.clear();
    }
    return known;
  }

  private read(id: string): Backup {
    if (!ID.test(id)) throw new Error("Invalid backup identifier.");
    const directory = Path.join(this.directory, id);
    if (FS.lstatSync(directory).isSymbolicLink())
      throw new Error("Backup directory must not be a link.");
    const manifest = Path.join(directory, "manifest.json");
    if (FS.lstatSync(manifest).isSymbolicLink() || FS.statSync(manifest).size > 64 * 1024 * 1024)
      throw new Error("Invalid backup manifest.");
    const backup = JSON.parse(FS.readFileSync(manifest, "utf8")) as Backup;
    if (
      (backup.format !== 1 && backup.format !== 2) ||
      backup.id !== id ||
      typeof backup.version !== "string" ||
      typeof backup.createdAt !== "string" ||
      !Number.isFinite(backup.bytes) ||
      backup.bytes < 0 ||
      typeof backup.reason !== "string" ||
      !Number.isFinite(Date.parse(backup.createdAt)) ||
      !Array.isArray(backup.roots) ||
      JSON.stringify(backup.roots.map((root) => root.source)) !== JSON.stringify(this.roots)
    )
      throw new Error("Backup does not belong to these application data paths.");
    return backup;
  }

  verify(id: string): Backup {
    const backup = this.read(id);
    const verifiedObjects = new Set<string>();
    backup.roots.forEach((root, index) => {
      if (typeof root.present !== "boolean" || !Array.isArray(root.entries))
        throw new Error("Invalid backup root.");
      if (backup.format === 2) {
        if (!root.present && root.entries.length) throw new Error("Invalid absent backup root.");
        assertRestorableEntries(root.entries);
        for (const entry of root.entries) {
          if (entry.hash === undefined || verifiedObjects.has(entry.hash)) continue;
          const object = this.objectPath(entry.hash);
          let valid = false;
          try {
            const stat = FS.lstatSync(object);
            valid = stat.isFile() && stat.size === entry.size && hashFile(object) === entry.hash;
          } catch {
            valid = false;
          }
          if (!valid) throw new Error("Backup verification failed. Current data was not changed.");
          verifiedObjects.add(entry.hash);
        }
        return;
      }
      if (
        root.present &&
        !sameContent(inventory(Path.join(this.directory, id, String(index))), root.entries)
      )
        throw new Error("Backup verification failed. Current data was not changed.");
      if (!root.present && root.entries.length) throw new Error("Invalid absent backup root.");
    });
    return backup;
  }

  /** Offline preparation never opens the target database with the running app.
   * The caller must exit immediately, then open the matching application release. */
  prepareVersionSwitch(id: string): void {
    this.recoverInterruptedRestore();
    const backup = this.verify(id);
    if (!parseSemver(backup.version) || backup.version === this.version)
      throw new Error("Choose a known snapshot for a different app version.");
    this.restoreVersion(id, backup.version);
  }

  /** Exact-version snapshots avoid claiming schema compatibility from semver alone. */
  restore(id: string, afterSwap?: () => void): void {
    this.restoreVersion(id, this.version, afterSwap);
  }

  private restoreVersion(id: string, targetVersion: string, afterSwap?: () => void): void {
    this.recoverInterruptedRestore();
    const backup = this.verify(id);
    if (backup.version !== targetVersion)
      throw new Error(
        `Open Tabs ${backup.version} to restore this snapshot. Current version: ${this.version}.`,
      );
    this.create("before-restore", this.dataVersion());
    const operations: RestoreOperation[] = backup.roots.map((root) => {
      const stage = `${root.source}.tabs-restore-${id}`;
      const previous = `${root.source}.tabs-previous-${id}`;
      if (FS.existsSync(stage) || FS.existsSync(previous))
        throw new Error("A previous recovery needs to finish first.");
      return {
        source: root.source,
        stage,
        previous,
        present: root.present,
        existed: FS.existsSync(root.source),
      };
    });
    writeJson(Path.join(this.directory, "restore.json"), { id, operations });
    try {
      for (const [index, operation] of operations.entries()) {
        if (!operation.present) continue;
        // Restored copies replace live data, so every file is flushed.
        if (backup.format === 2)
          materialize(
            backup.roots[index]!.entries,
            (hash) => this.objectPath(hash),
            operation.stage,
          );
        else copyTree(Path.join(this.directory, id, String(index)), operation.stage, true);
        if (!sameContent(inventory(operation.stage), backup.roots[index]!.entries))
          throw new Error("Restore staging verification failed.");
      }
      for (const operation of operations) {
        if (FS.existsSync(operation.source)) move(operation.source, operation.previous);
        if (operation.present) move(operation.stage, operation.source);
        afterSwap?.();
      }
      // A durable commit distinguishes cleanup from interrupted replacement.
      writeJson(Path.join(this.directory, "restore.json"), {
        id,
        operations,
        committed: true,
        version: targetVersion,
      });
    } catch (error) {
      this.recoverInterruptedRestore();
      throw error;
    }
    this.recoverInterruptedRestore();
    this.markVersion(targetVersion);
    writeJson(Path.join(this.directory, "last-recovery.json"), {
      version: targetVersion,
      id,
      at: new Date().toISOString(),
    });
  }

  notice(): string | null {
    try {
      const receipt = JSON.parse(
        FS.readFileSync(Path.join(this.directory, "last-recovery.json"), "utf8"),
      );
      return typeof receipt.version === "string" && typeof receipt.at === "string"
        ? `A recovery on ${receipt.at} restored data for Tabs ${receipt.version}. Your newer data is retained in a before-recovery snapshot; open its matching Tabs version to restore it.`
        : null;
    } catch {
      return null;
    }
  }

  recoverInterruptedRestore(): void {
    const path = Path.join(this.directory, "restore.json");
    if (!FS.existsSync(path)) return;
    const journal = JSON.parse(FS.readFileSync(path, "utf8")) as {
      id: string;
      operations: RestoreOperation[];
      committed?: boolean;
      version?: string;
    };
    if (
      (journal.committed !== undefined && journal.committed !== true) ||
      (journal.committed === true && typeof journal.version !== "string") ||
      !ID.test(journal.id) ||
      !Array.isArray(journal.operations) ||
      journal.operations.length !== this.roots.length
    )
      throw new Error("Invalid recovery journal; saved data was left untouched.");
    for (const [index, operation] of journal.operations.entries()) {
      if (
        typeof operation.present !== "boolean" ||
        typeof operation.existed !== "boolean" ||
        operation.source !== this.roots[index] ||
        operation.stage !== `${operation.source}.tabs-restore-${journal.id}` ||
        operation.previous !== `${operation.source}.tabs-previous-${journal.id}`
      )
        throw new Error("Invalid recovery paths; saved data was left untouched.");
    }
    for (const operation of [...journal.operations].reverse()) {
      if (!journal.committed && FS.existsSync(operation.previous)) {
        // The current tree is our staged copy. The original is still intact.
        removeInternalTree(operation.source);
        move(operation.previous, operation.source);
      }
      if (!journal.committed && !operation.existed) removeInternalTree(operation.source);
      if (journal.committed) removeInternalTree(operation.previous);
      removeInternalTree(operation.stage);
    }
    if (journal.committed && journal.version)
      writeJson(Path.join(this.directory, "version.json"), {
        version: journal.version,
        updatedAt: new Date().toISOString(),
      });
    FS.unlinkSync(path);
    syncDirectory(this.directory);
  }

  private dataVersion(): string {
    try {
      const value = JSON.parse(
        FS.readFileSync(Path.join(this.directory, "version.json"), "utf8"),
      ).version;
      return typeof value === "string" ? value : this.version;
    } catch {
      return this.version;
    }
  }

  remove(id: string): void {
    this.read(id);
    if (FS.existsSync(Path.join(this.directory, "restore.json")))
      throw new Error("Finish recovery before deleting snapshots.");
    removeInternalTree(Path.join(this.directory, id));
    this.collectUnreferencedObjects();
  }

  /** Deletes stored contents no remaining snapshot refers to. If any snapshot
   * cannot be read, nothing is deleted: it might still need those objects. */
  private collectUnreferencedObjects(): void {
    if (!FS.existsSync(this.objectsDirectory)) return;
    const referenced = new Set<string>();
    for (const name of FS.readdirSync(this.directory)) {
      if (!ID.test(name)) continue;
      let backup: Backup;
      try {
        backup = this.read(name);
      } catch {
        return;
      }
      if (backup.format !== 2) continue;
      for (const root of backup.roots)
        for (const entry of root.entries) if (entry.hash) referenced.add(entry.hash);
    }
    for (const prefix of FS.readdirSync(this.objectsDirectory)) {
      if (!/^[0-9a-f]{2}$/.test(prefix)) continue;
      const directory = Path.join(this.objectsDirectory, prefix);
      for (const name of FS.readdirSync(directory)) {
        if (HASH.test(name) && !referenced.has(name)) FS.rmSync(Path.join(directory, name));
      }
    }
  }

  private discardObjects(hashes: readonly string[]): void {
    for (const hash of hashes) FS.rmSync(this.objectPath(hash), { force: true });
    // Leave no empty store behind for a snapshot that was never published.
    const prefixes = new Set(hashes.map((hash) => Path.dirname(this.objectPath(hash))));
    for (const directory of [...prefixes, this.objectsDirectory]) {
      try {
        if (FS.readdirSync(directory).length === 0) FS.rmdirSync(directory);
      } catch {
        /* Already gone, or still holds other snapshots' objects. */
      }
    }
  }

  /** Objects interrupted before they were named are never referenced. */
  private removeTemporaryObjects(): void {
    if (!FS.existsSync(this.objectsDirectory)) return;
    for (const prefix of FS.readdirSync(this.objectsDirectory)) {
      const directory = Path.join(this.objectsDirectory, prefix);
      if (!/^[0-9a-f]{2}$/.test(prefix) || !FS.lstatSync(directory).isDirectory()) continue;
      for (const name of FS.readdirSync(directory))
        if (name.startsWith(OBJECT_TEMP_PREFIX)) FS.rmSync(Path.join(directory, name));
    }
  }

  private markVersion(version = this.version): void {
    writeJson(Path.join(this.directory, "version.json"), {
      version,
      updatedAt: new Date().toISOString(),
    });
  }

  startup(): { restored?: string; backup?: string } {
    this.recoverInterruptedRestore();
    for (const name of FS.readdirSync(this.directory)) {
      if (/^[0-9a-f-]{36}\.partial$/.test(name))
        removeInternalTree(Path.join(this.directory, name));
    }
    this.removeTemporaryObjects();
    let previous: string | undefined;
    try {
      previous = JSON.parse(
        FS.readFileSync(Path.join(this.directory, "version.json"), "utf8"),
      ).version;
    } catch {
      /* first launch */
    }
    if (
      previous &&
      previous !== this.version &&
      compareSemverVersions(previous, this.version) > 0
    ) {
      const compatible = this.list().find((backup) => backup.version === this.version);
      if (!compatible) {
        const preserved = this.list().find(
          (entry) => entry.reason === "before-downgrade" && entry.version === previous,
        );
        let unchanged = false;
        if (preserved) {
          try {
            const snapshot = this.verify(preserved.id);
            unchanged = snapshot.roots.every(
              (root) =>
                root.present === FS.existsSync(root.source) &&
                (!root.present ||
                  sameContent(root.entries, inventory(root.source, stampedHashes(root.entries)))),
            );
          } catch {
            /* Publish a new verified copy if the older snapshot is damaged. */
          }
        }
        if (!unchanged) this.create("before-downgrade", previous);
        throw new Error(
          `Tabs ${previous} last opened this data. No snapshot for ${this.version} is available. Reopen Tabs ${previous}; your current data is preserved. Recovery snapshots: ${this.directory}`,
        );
      }
      this.restore(compatible.id);
      return { restored: compatible.id };
    }
    const latest = this.list()[0];
    if (
      previous !== this.version ||
      !latest ||
      Date.now() - Date.parse(latest.createdAt) >= 86_400_000
    ) {
      const backup = this.create(
        previous ? (previous !== this.version ? "before-version-change" : "daily") : "initial",
        previous ?? "unknown",
      );
      this.markVersion();
      return { backup: backup.id };
    }
    return {};
  }
}
