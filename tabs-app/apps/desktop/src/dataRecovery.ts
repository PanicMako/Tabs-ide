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
}
interface Backup extends DataBackupSummary {
  format: 1;
  createdByVersion: string;
  roots: Array<{ source: string; present: boolean; entries: Entry[] }>;
}
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
    ["node-compile-cache", "desktop-dev.log", "code-host-manager.log"].some(
      (name) => normalized === name || normalized.startsWith(`${name}/`),
    )
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

function inventory(root: string): Entry[] {
  if (FS.lstatSync(root).isSymbolicLink() || !FS.statSync(root).isDirectory())
    throw new Error("Backup root must be a real directory.");
  const entries: Entry[] = [];
  const walk = (directory: string): void => {
    for (const name of FS.readdirSync(directory).sort()) {
      const path = Path.join(directory, name);
      if (excluded(Path.relative(root, path))) continue;
      const stat = backupStat(path);
      if (!stat) continue;
      if (entries.length >= 250_000) throw new Error("Backup contains too many files.");
      entries.push({
        path: Path.relative(root, path),
        mode: stat.mode & 0o777,
        ...(stat.isFile() ? { size: stat.size, hash: hashFile(path) } : {}),
        ...(stat.isSymbolicLink() ? { link: FS.readlinkSync(path) } : {}),
      });
      if (stat.isDirectory()) walk(path);
    }
  };
  walk(root);
  return entries;
}
function copyTree(source: string, destination: string, prefix = ""): void {
  FS.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const name of FS.readdirSync(source)) {
    const relative = Path.join(prefix, name);
    if (excluded(relative)) continue;
    const from = Path.join(source, name);
    const to = Path.join(destination, name);
    const stat = backupStat(from);
    if (!stat) continue;
    if (stat.isDirectory()) {
      copyTree(from, to, relative);
      FS.chmodSync(to, stat.mode & 0o777);
    } else if (stat.isFile()) {
      FS.copyFileSync(from, to, FS.constants.COPYFILE_FICLONE);
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
  syncDirectory(destination);
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
          const backup = this.read(id);
          return [
            {
              id,
              version: backup.version,
              createdAt: backup.createdAt,
              reason: backup.reason,
              bytes: backup.bytes,
            },
          ];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
    try {
      const roots = this.roots.map((source) => {
        if (FS.existsSync(source) && !FS.statSync(source).isDirectory())
          throw new Error(`Backup root is not a directory: ${source}`);
        return {
          source,
          present: FS.existsSync(source),
          entries: FS.existsSync(source) ? inventory(source) : [],
        };
      });
      const bytes = roots
        .flatMap((root) => root.entries)
        .reduce((sum, entry) => sum + (entry.size ?? 0), 0);
      if (this.freeDiskBytes(this.directory) < bytes + 64 * 1024 * 1024)
        throw new Error(
          "Not enough free space for a verified data backup. Free disk space and restart Tabs.",
        );
      roots.forEach((root, index) => {
        if (!root.present) return;
        const destination = Path.join(stage, String(index));
        copyTree(root.source, destination);
        if (JSON.stringify(inventory(destination)) !== JSON.stringify(root.entries))
          throw new Error("Backup changed while being copied; no complete snapshot was published.");
      });
      const backup: Backup = {
        format: 1,
        createdByVersion: this.version,
        id,
        version,
        createdAt: new Date().toISOString(),
        reason,
        bytes,
        roots,
      };
      writeJson(Path.join(stage, "manifest.json"), backup);
      move(stage, Path.join(this.directory, id));
      return { id, version, createdAt: backup.createdAt, reason, bytes };
    } catch (error) {
      removeInternalTree(stage);
      throw error;
    }
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
      backup.format !== 1 ||
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
    backup.roots.forEach((root, index) => {
      if (typeof root.present !== "boolean" || !Array.isArray(root.entries))
        throw new Error("Invalid backup root.");
      if (
        root.present &&
        JSON.stringify(inventory(Path.join(this.directory, id, String(index)))) !==
          JSON.stringify(root.entries)
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
        copyTree(Path.join(this.directory, id, String(index)), operation.stage);
        if (
          JSON.stringify(inventory(operation.stage)) !==
          JSON.stringify(backup.roots[index]!.entries)
        )
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
                  JSON.stringify(root.entries) === JSON.stringify(inventory(root.source))),
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
