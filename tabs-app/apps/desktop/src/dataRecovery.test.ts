import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { DataRecovery } from "./dataRecovery";

// Wrap the native module so fault injection can model filesystem races and
// permission failures without changing real user data or depending on uid.
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
}));

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    FS.rmSync(directory, { recursive: true, force: true });
});
/** Stored content of one file in a snapshot, read the way restore reads it. */
function storedObject(backups: string, id: string, source: string, path: string): string {
  const manifest = JSON.parse(FS.readFileSync(Path.join(backups, id, "manifest.json"), "utf8"));
  const root = manifest.roots.find((candidate: { source: string }) => candidate.source === source);
  const hash = root.entries.find((entry: { path: string }) => entry.path === path).hash as string;
  return Path.join(backups, "objects", hash.slice(0, 2), hash);
}
function fixture(version = "1.0.0") {
  const directory = FS.realpathSync(FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-recovery-")));
  directories.push(directory);
  const state = Path.join(directory, "state");
  const profile = Path.join(directory, "profile");
  const backups = Path.join(directory, "backups");
  FS.mkdirSync(state);
  FS.mkdirSync(profile);
  FS.writeFileSync(Path.join(state, "settings.json"), "old settings");
  FS.mkdirSync(Path.join(profile, "Local Storage"));
  FS.writeFileSync(Path.join(profile, "Local Storage", "profile"), "old profile");
  return {
    directory,
    state,
    profile,
    backups,
    manager: new DataRecovery(backups, [state, profile], version),
  };
}
it("backs up every durable store, empty directories and permissions; ignores Chromium singleton files", () => {
  const { state, profile, manager } = fixture();
  FS.mkdirSync(Path.join(state, "empty"));
  FS.mkdirSync(Path.join(state, "extension-credentials"), { mode: 0o700 });
  FS.writeFileSync(Path.join(state, "extension-credentials", "encrypted"), "ciphertext", {
    mode: 0o600,
  });
  FS.symlinkSync("/absent/socket", Path.join(profile, "SingletonSocket"));
  const backup = manager.create("manual");
  const verified = manager.verify(backup.id);
  expect(
    verified.roots
      .flatMap((root) => root.entries)
      .some((entry) => entry.path.endsWith("encrypted")),
  ).toBe(true);
  expect(FS.statSync(manager.directory).mode & 0o777).toBe(0o700);
  expect(manager.list()).toHaveLength(1);
  expect(backup.bytes).toBeGreaterThan(0);
});
it("deduplicates nested roots and rejects a backup stored within live data", () => {
  const { directory, state, backups } = fixture();
  const manager = new DataRecovery(backups, [state, Path.join(state, "code"), state], "1.0.0");
  expect(manager.roots).toHaveLength(1);
  expect(() => new DataRecovery(Path.join(state, "backups"), [state], "1.0.0")).toThrow(/separate/);
  expect(() => new DataRecovery(directory, [state], "1.0.0")).toThrow(/separate/);
});
it("creates daily/version snapshots before migration and restores an exact older version while preserving newer state", () => {
  const { state, profile, backups, manager } = fixture();
  manager.startup();
  const baseline = manager.list()[0]!;
  expect(baseline.version).toBe("unknown");
  expect(manager.startup()).toEqual({});
  const newer = new DataRecovery(backups, [state, profile], "2.0.0");
  newer.startup();
  FS.writeFileSync(Path.join(state, "settings.json"), "new settings");
  FS.writeFileSync(Path.join(profile, "Local Storage", "profile"), "new profile");
  const result = manager.startup();
  expect(result.restored).toBeDefined();
  expect(FS.readFileSync(Path.join(state, "settings.json"), "utf8")).toBe("old settings");
  expect(FS.readFileSync(Path.join(profile, "Local Storage", "profile"), "utf8")).toBe(
    "old profile",
  );
  const preserved = manager.list().find((entry) => entry.reason === "before-restore")!;
  expect(preserved.version).toBe("2.0.0");
  expect(FS.readFileSync(storedObject(backups, preserved.id, state, "settings.json"), "utf8")).toBe(
    "new settings",
  );
});
it("blocks an unsupported downgrade and preserves current files", () => {
  const { state, profile, backups, manager } = fixture("3.0.0");
  manager.startup();
  const older = new DataRecovery(backups, [state, profile], "2.0.0");
  expect(() => older.startup()).toThrow(/No snapshot/);
  expect(FS.readFileSync(Path.join(state, "settings.json"), "utf8")).toBe("old settings");
  expect(older.list().some((entry) => entry.reason === "before-downgrade")).toBe(true);
});
it("verifies content before changing live files or publishing a preservation snapshot", () => {
  const { state, manager, backups } = fixture();
  const backup = manager.create("manual");
  const object = storedObject(backups, backup.id, state, "settings.json");
  FS.chmodSync(object, 0o600);
  FS.writeFileSync(object, "tampered");
  expect(() => manager.restore(backup.id)).toThrow(/verification failed/);
  expect(FS.readFileSync(Path.join(state, "settings.json"), "utf8")).toBe("old settings");
  expect(manager.list()).toHaveLength(1);
});
it("refuses root substitution and path traversal while preserving links without following them", () => {
  const { state, profile, manager, backups, directory } = fixture();
  expect(() => manager.verify("../../state")).toThrow(/identifier/);
  FS.symlinkSync(Path.join(profile, "Local Storage"), Path.join(state, "external"));
  const backup = manager.create("manual");
  const link = manager
    .verify(backup.id)
    .roots.find((root) => root.source === state)!
    .entries.find((entry) => entry.path === "external")!;
  expect(link).toMatchObject({ link: Path.join(profile, "Local Storage") });
  expect(link.hash).toBeUndefined();
  manager.restore(backup.id);
  expect(FS.lstatSync(Path.join(state, "external")).isSymbolicLink()).toBe(true);
  expect(FS.readlinkSync(Path.join(state, "external"))).toBe(Path.join(profile, "Local Storage"));
  const foreign = new DataRecovery(backups, [Path.join(directory, "different")], "1.0.0");
  expect(() => foreign.restore(backup.id)).toThrow(/paths/);
});
it("does not activate a snapshot produced by another version", () => {
  const { state, profile, backups, manager } = fixture();
  const backup = manager.create("manual");
  const other = new DataRecovery(backups, [state, profile], "2.0.0");
  expect(() => other.restore(backup.id)).toThrow(/Open Tabs 1.0.0/);
});
it("rolls back all roots when a restore fails between swaps", () => {
  const { state, profile, manager } = fixture();
  const backup = manager.create("manual");
  FS.writeFileSync(Path.join(state, "settings.json"), "new settings");
  FS.writeFileSync(Path.join(profile, "Local Storage", "profile"), "new profile");
  expect(() =>
    manager.restore(backup.id, () => {
      throw new Error("simulated interrupted replacement");
    }),
  ).toThrow(/simulated/);
  expect(FS.readFileSync(Path.join(state, "settings.json"), "utf8")).toBe("new settings");
  expect(FS.readFileSync(Path.join(profile, "Local Storage", "profile"), "utf8")).toBe(
    "new profile",
  );
  expect(FS.existsSync(Path.join(manager.directory, "restore.json"))).toBe(false);
});
it("restores absent roots and removes files that did not exist at the selected point", () => {
  const { state, profile, backups } = fixture();
  FS.rmSync(profile, { recursive: true });
  const manager = new DataRecovery(backups, [state, profile], "1.0.0");
  const backup = manager.create("manual");
  FS.mkdirSync(profile);
  FS.writeFileSync(Path.join(profile, "new"), "new");
  FS.writeFileSync(Path.join(state, "new"), "new");
  manager.restore(backup.id);
  expect(FS.existsSync(profile)).toBe(false);
  expect(FS.existsSync(Path.join(state, "new"))).toBe(false);
});
it("recovers an interrupted journal before using any live store", () => {
  const { manager, state } = fixture();
  const backup = manager.create("manual");
  const operations = manager.roots.map((source) => ({
    source,
    stage: `${source}.tabs-restore-${backup.id}`,
    previous: `${source}.tabs-previous-${backup.id}`,
    present: true,
    existed: true,
  }));
  const operation = operations.find((entry) => entry.source === state)!;
  FS.renameSync(state, operation.previous);
  FS.mkdirSync(operation.source);
  FS.writeFileSync(Path.join(operation.source, "wrong"), "incomplete");
  FS.writeFileSync(
    Path.join(manager.directory, "restore.json"),
    JSON.stringify({ id: backup.id, operations }),
  );
  manager.recoverInterruptedRestore();
  expect(FS.readFileSync(Path.join(state, "settings.json"), "utf8")).toBe("old settings");
  expect(FS.existsSync(Path.join(state, "wrong"))).toBe(false);
});
it("refuses a forged restore journal before modifying any roots", () => {
  const { manager, state } = fixture();
  const backup = manager.create("manual");
  FS.writeFileSync(
    Path.join(manager.directory, "restore.json"),
    JSON.stringify({
      id: backup.id,
      operations: manager.roots.map((source) => ({
        source: `${source}-other`,
        stage: "bad",
        previous: "bad",
      })),
    }),
  );
  expect(() => manager.recoverInterruptedRestore()).toThrow(/paths/);
  expect(FS.existsSync(Path.join(state, "settings.json"))).toBe(true);
});
it("restores a real migrated SQLite database while retaining the newer database", () => {
  const { state, manager } = fixture();
  const path = Path.join(state, "statev2.sqlite");
  let db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE history (message TEXT); INSERT INTO history VALUES ('before update')",
  );
  db.close();
  const backup = manager.create("manual");
  db = new DatabaseSync(path);
  db.exec(
    "ALTER TABLE history ADD COLUMN newer TEXT; INSERT INTO history VALUES ('after update', 'extra')",
  );
  db.close();
  manager.restore(backup.id);
  db = new DatabaseSync(path, { readOnly: true });
  expect(db.prepare("SELECT * FROM history").all()).toEqual([{ message: "before update" }]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  db.close();
});
it("fails safely when storage is full and does not advertise incomplete backups", () => {
  const { manager, state } = fixture();
  const full = new DataRecovery(manager.directory, manager.roots, "1.0.0", () => 0);
  expect(() => full.create("manual")).toThrow(/free space/);
  expect(manager.list()).toEqual([]);
  expect(FS.existsSync(Path.join(state, "settings.json"))).toBe(true);
});
it("prevents concurrent desktop profiles from using the same store", () => {
  const { manager, state, profile, backups } = fixture();
  manager.acquireLocks();
  const other = new DataRecovery(backups, [state, profile], "1.0.0");
  expect(() => other.acquireLocks()).toThrow(/Another Tabs/);
  manager.releaseLocks();
  other.acquireLocks();
  other.releaseLocks();
});
it("only deletes the selected backup, leaving live data and other versions intact", () => {
  const { state, manager } = fixture();
  const first = manager.create("manual");
  const second = manager.create("manual", "2.0.0");
  manager.remove(first.id);
  expect(manager.list().map((backup) => backup.id)).toEqual([second.id]);
  expect(FS.existsSync(Path.join(state, "settings.json"))).toBe(true);
});

it("does not copy a store whose workspace server is still running", () => {
  const { state, manager } = fixture();
  FS.writeFileSync(Path.join(state, "server-runtime.json"), JSON.stringify({ pid: process.pid }));
  expect(() => manager.create("manual")).toThrow(/server is still/);
  expect(manager.list()).toEqual([]);
});

it("excludes regenerable caches without dropping extension-owned files with the same name", () => {
  const { state, manager } = fixture();
  FS.mkdirSync(Path.join(state, "Cache"));
  FS.writeFileSync(Path.join(state, "Cache", "cache"), "regenerable");
  FS.mkdirSync(Path.join(state, "extension-storage", "Cache"), { recursive: true });
  FS.writeFileSync(Path.join(state, "extension-storage", "Cache", "saved"), "durable");
  const backup = manager.create("manual");
  const entries = manager.verify(backup.id).roots.flatMap((root) => root.entries);
  expect(entries.some((entry) => entry.path === Path.join("Cache", "cache"))).toBe(false);
  expect(
    entries.some((entry) => entry.path === Path.join("extension-storage", "Cache", "saved")),
  ).toBe(true);
});
it("restores read-only directory modes and can clean up its own staged copies", () => {
  const { state, manager } = fixture();
  const directory = Path.join(state, "readonly");
  FS.mkdirSync(directory);
  FS.writeFileSync(Path.join(directory, "data"), "saved");
  FS.chmodSync(directory, 0o555);
  const backup = manager.create("manual");
  manager.restore(backup.id);
  expect(FS.statSync(directory).mode & 0o777).toBe(0o555);
  for (const entry of manager.list()) manager.remove(entry.id);
  FS.chmodSync(directory, 0o755);
});
it("preserves committed SQLite WAL data left by an abruptly terminated process", () => {
  const { state, manager } = fixture();
  const path = Path.join(state, "wal.sqlite");
  const child = spawnSync(process.execPath, [
    "-e",
    `const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.argv[1]); db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE history (message TEXT); INSERT INTO history VALUES ('committed in WAL')"); process.kill(process.pid, 'SIGKILL');`,
    path,
  ]);
  expect(child.status).not.toBe(0);
  expect(FS.existsSync(`${path}-wal`)).toBe(true);
  const backup = manager.create("manual");
  FS.rmSync(path);
  FS.rmSync(`${path}-wal`, { force: true });
  FS.rmSync(`${path}-shm`, { force: true });
  manager.restore(backup.id);
  const db = new DatabaseSync(path);
  expect(db.prepare("SELECT * FROM history").all()).toEqual([{ message: "committed in WAL" }]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  db.close();
});

it("rolls back newly created roots when a restore is interrupted", () => {
  const { state, profile, manager } = fixture();
  const backup = manager.create("manual");
  FS.rmSync(profile, { recursive: true });
  expect(() =>
    manager.restore(backup.id, () => {
      throw new Error("interrupted");
    }),
  ).toThrow(/interrupted/);
  expect(FS.existsSync(profile)).toBe(false);
  expect(FS.readFileSync(Path.join(state, "settings.json"), "utf8")).toBe("old settings");
});
it("finishes a committed restore journal without rolling back restored files", () => {
  const { state, manager } = fixture();
  const backup = manager.create("manual");
  const operations = manager.roots.map((source) => ({
    source,
    stage: `${source}.tabs-restore-${backup.id}`,
    previous: `${source}.tabs-previous-${backup.id}`,
    present: true,
    existed: true,
  }));
  for (const operation of operations) {
    FS.mkdirSync(operation.previous);
    FS.writeFileSync(Path.join(operation.previous, "older"), "old");
  }
  FS.writeFileSync(
    Path.join(manager.directory, "restore.json"),
    JSON.stringify({ id: backup.id, operations, committed: true, version: "1.0.0" }),
  );
  manager.recoverInterruptedRestore();
  expect(FS.readFileSync(Path.join(state, "settings.json"), "utf8")).toBe("old settings");
  expect(operations.every((operation) => !FS.existsSync(operation.previous))).toBe(true);
});
it("does not publish an inconsistent snapshot if files change while copying", () => {
  const { state, manager } = fixture();
  const changing = new DataRecovery(manager.directory, manager.roots, "1.0.0", () => {
    FS.writeFileSync(Path.join(state, "settings.json"), "changed during snapshot");
    return Number.MAX_SAFE_INTEGER;
  });
  expect(() => changing.create("manual")).toThrow(/changed while/);
  expect(changing.list()).toHaveLength(0);
  expect(FS.readFileSync(Path.join(state, "settings.json"), "utf8")).toBe(
    "changed during snapshot",
  );
});

it("takes a daily checkpoint on a later startup without duplicating it on every launch", () => {
  const { manager } = fixture();
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-10-27T10:00:00Z"));
    manager.startup();
    vi.setSystemTime(new Date("2026-10-28T11:00:00Z"));
    expect(manager.startup().backup).toBeDefined();
    expect(manager.list()[0]).toMatchObject({ version: "1.0.0", reason: "daily" });
    expect(manager.startup()).toEqual({});
    expect(manager.list()).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});
it("removes abandoned partial snapshots without following their symbolic links", () => {
  const { manager, state } = fixture();
  const partial = Path.join(manager.directory, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.partial");
  FS.symlinkSync(state, partial);
  manager.startup();
  expect(FS.existsSync(partial)).toBe(false);
  expect(FS.existsSync(Path.join(state, "settings.json"))).toBe(true);
});
it("rejects a journal with a malformed commit flag before modifying data", () => {
  const { manager, state } = fixture();
  const backup = manager.create("manual");
  FS.writeFileSync(
    Path.join(manager.directory, "restore.json"),
    JSON.stringify({ id: backup.id, committed: "false", operations: [] }),
  );
  expect(() => manager.recoverInterruptedRestore()).toThrow(/Invalid recovery journal/);
  expect(FS.existsSync(Path.join(state, "settings.json"))).toBe(true);
});

it("can prepare an older release's data using a newer recovery controller without opening that database", () => {
  const { state, profile, backups, manager } = fixture();
  manager.startup();
  const older = manager.create("manual");
  const newer = new DataRecovery(backups, [state, profile], "2.0.0");
  newer.startup();
  FS.writeFileSync(Path.join(state, "settings.json"), "newer history");
  newer.prepareVersionSwitch(older.id);
  expect(JSON.parse(FS.readFileSync(Path.join(backups, "version.json"), "utf8")).version).toBe(
    "1.0.0",
  );
  expect(FS.readFileSync(Path.join(state, "settings.json"), "utf8")).toBe("old settings");
  const preserved = newer.list().find((entry) => entry.reason === "before-restore")!;
  expect(preserved.version).toBe("2.0.0");
  expect(FS.readFileSync(storedObject(backups, preserved.id, state, "settings.json"), "utf8")).toBe(
    "newer history",
  );
  expect(manager.startup()).toEqual({});
});
it("does not prepare a version switch from an unversioned initial snapshot", () => {
  const { state, manager } = fixture();
  manager.startup();
  const unknown = manager.list()[0]!;
  expect(() => manager.prepareVersionSwitch(unknown.id)).toThrow(/known snapshot/);
  expect(FS.readFileSync(Path.join(state, "settings.json"), "utf8")).toBe("old settings");
});

it.skipIf(process.platform === "win32")(
  "starts, verifies and restores with Code OSS IPC sockets while preserving regular .sock files",
  async () => {
    const directory = FS.realpathSync(FS.mkdtempSync("/tmp/tabs-ipc-"));
    directories.push(directory);
    const state = Path.join(directory, "userdata");
    const code = Path.join(state, "code-oss-main");
    FS.mkdirSync(code, { recursive: true });
    const socket = Path.join(code, "1.11-main.sock");
    const saved = Path.join(code, "saved.sock");
    FS.writeFileSync(saved, "durable data despite the suffix");
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socket, resolve);
    });
    try {
      const manager = new DataRecovery(Path.join(directory, "backups"), [state], "2.2.1");
      const result = manager.startup();
      const snapshot = manager.verify(result.backup!);
      expect(snapshot.roots[0]!.entries.map((entry) => entry.path)).toEqual([
        "code-oss-main",
        Path.join("code-oss-main", "saved.sock"),
      ]);
      expect(FS.lstatSync(socket).isSocket()).toBe(true);
      expect(manager.startup()).toEqual({});
      const restorable = manager.create("manual");
      FS.writeFileSync(saved, "new data");
      manager.restore(restorable.id);
      expect(FS.existsSync(socket)).toBe(false);
      expect(FS.readFileSync(saved, "utf8")).toBe("durable data despite the suffix");
      expect(manager.list()).toHaveLength(3);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

it.skipIf(process.platform === "win32")(
  "skips named pipes regardless of name without dropping saved files named like runtime endpoints",
  () => {
    const { state, manager } = fixture();
    const pipe = Path.join(state, "extension-runtime");
    expect(spawnSync("mkfifo", [pipe]).status).toBe(0);
    FS.writeFileSync(Path.join(state, "session.pipe"), "saved session");
    const backup = manager.create("manual");
    expect(
      manager
        .verify(backup.id)
        .roots.flatMap((root) => root.entries)
        .some((entry) => entry.path === "extension-runtime"),
    ).toBe(false);
    manager.restore(backup.id);
    expect(FS.existsSync(pipe)).toBe(false);
    expect(FS.readFileSync(Path.join(state, "session.pipe"), "utf8")).toBe("saved session");
  },
);

it("tolerates entries disappearing before inspection", () => {
  const { state, manager } = fixture();
  const runtime = Path.join(state, "ephemeral-endpoint");
  FS.writeFileSync(runtime, "temporary");
  const lstat = FS.lstatSync;
  vi.spyOn(FS, "lstatSync").mockImplementation((...args: Parameters<typeof FS.lstatSync>) => {
    if (args[0] === runtime) FS.rmSync(runtime, { force: true });
    return lstat(...args);
  });
  const backup = manager.create("manual");
  expect(
    manager
      .verify(backup.id)
      .roots.flatMap((root) => root.entries)
      .some((entry) => entry.path === "ephemeral-endpoint"),
  ).toBe(false);
});

it("does not publish a snapshot when saved data disappears during copying", () => {
  const { state, manager } = fixture();
  const missing = new DataRecovery(manager.directory, manager.roots, "1.0.0", () => {
    FS.unlinkSync(Path.join(state, "settings.json"));
    return Number.MAX_SAFE_INTEGER;
  });
  expect(() => missing.create("manual")).toThrow(/changed while/);
  expect(missing.list()).toEqual([]);
  expect(FS.readdirSync(manager.directory)).toEqual([]);
});

it("keeps permission failures on saved data visible instead of publishing an incomplete backup", () => {
  const { state, manager } = fixture();
  const lstat = FS.lstatSync;
  vi.spyOn(FS, "lstatSync").mockImplementation((...args: Parameters<typeof FS.lstatSync>) => {
    if (args[0] === Path.join(state, "settings.json"))
      throw Object.assign(new Error("Permission denied: settings.json"), { code: "EACCES" });
    return lstat(...args);
  });
  expect(() => manager.create("manual")).toThrow(/Permission denied/);
  expect(manager.list()).toEqual([]);
  expect(FS.readFileSync(Path.join(state, "settings.json"), "utf8")).toBe("old settings");
});

function stateEntries(manager: DataRecovery, id: string, state: string) {
  return manager.verify(id).roots.find((root) => root.source === state)!.entries;
}

it("publishes a snapshot without flushing each copied file, but flushes every restored file", () => {
  const { state, backups, profile } = fixture();
  const manager = new DataRecovery(backups, [state, profile], "1.0.0", undefined, false);
  for (let index = 0; index < 40; index += 1)
    FS.writeFileSync(Path.join(state, `file-${index}.json`), `value ${index}`);
  const fsync = vi.spyOn(FS, "fsyncSync");
  const backup = manager.create("manual");
  // Only the manifest and the publishing renames are flushed, however many files.
  expect(fsync.mock.calls.length).toBeLessThan(10);
  expect(stateEntries(manager, backup.id, state)).toHaveLength(41);

  fsync.mockClear();
  manager.restore(backup.id);
  expect(fsync.mock.calls.length).toBeGreaterThan(41);
  expect(FS.readFileSync(Path.join(state, "file-39.json"), "utf8")).toBe("value 39");
});

it("reuses hashes of unchanged files from the previous snapshot and rehashes changed ones", () => {
  const { state, manager } = fixture();
  FS.writeFileSync(Path.join(state, "unchanged.bin"), "same bytes");
  manager.create("manual");
  FS.writeFileSync(Path.join(state, "settings.json"), "new settings");

  const unchanged = Path.join(state, "unchanged.bin");
  const changed = Path.join(state, "settings.json");
  const open = vi.spyOn(FS, "openSync");
  const second = manager.create("manual");
  const reads = (path: string) =>
    open.mock.calls.filter(([file, flags]) => file === path && flags === "r").length;
  expect(reads(unchanged)).toBe(0);
  expect(reads(changed)).toBe(1);

  open.mockRestore();
  const entries = stateEntries(manager, second.id, state);
  const first = stateEntries(manager, manager.list()[1]!.id, state);
  const hashOf = (list: typeof entries, path: string) =>
    list.find((entry) => entry.path === path)?.hash;
  expect(hashOf(entries, "unchanged.bin")).toBe(hashOf(first, "unchanged.bin"));
  expect(hashOf(entries, "settings.json")).not.toBe(hashOf(first, "settings.json"));
});

it("does not reuse a hash when a file is rewritten with the same size", () => {
  const { state, manager } = fixture();
  manager.create("manual");
  // Same length as "old settings", so only the stamp can reveal the change.
  FS.writeFileSync(Path.join(state, "settings.json"), "new settings");
  const backup = manager.create("manual");
  manager.restore(manager.list()[1]!.id);
  expect(FS.readFileSync(Path.join(state, "settings.json"), "utf8")).toBe("old settings");
  // The newer snapshot recorded the new bytes, not the reused old hash.
  expect(() => manager.verify(backup.id)).not.toThrow();
});

it("still verifies and extends snapshots written before stamps existed", () => {
  const { manager } = fixture();
  const backup = manager.create("manual");
  const manifestPath = Path.join(manager.directory, backup.id, "manifest.json");
  const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
  for (const root of manifest.roots)
    for (const entry of root.entries) delete (entry as { stamp?: string }).stamp;
  FS.chmodSync(manifestPath, 0o600);
  FS.writeFileSync(manifestPath, JSON.stringify(manifest));
  expect(() => manager.verify(backup.id)).not.toThrow();
  expect(() => manager.verify(manager.create("manual").id)).not.toThrow();
});

it("leaves Code's cached extension downloads out of snapshots", () => {
  const { state, manager } = fixture();
  const cache = Path.join(state, "code-oss-desktop", "shared-process", "CachedExtensionVSIXs");
  FS.mkdirSync(cache, { recursive: true });
  FS.writeFileSync(Path.join(cache, "publisher.extension-1.0.0"), "vsix bytes");
  FS.mkdirSync(Path.join(state, "code-oss-desktop", "extensions"), { recursive: true });
  FS.writeFileSync(Path.join(state, "code-oss-desktop", "extensions", "extensions.json"), "[]");
  const entries = stateEntries(manager, manager.create("manual").id, state);
  expect(entries.some((entry) => entry.path.includes("CachedExtensionVSIXs"))).toBe(false);
  expect(
    entries.some(
      (entry) => entry.path === Path.join("code-oss-desktop", "extensions", "extensions.json"),
    ),
  ).toBe(true);
});

it("copies nothing when a later snapshot finds the data unchanged", () => {
  const { state, manager } = fixture();
  for (let index = 0; index < 20; index += 1)
    FS.writeFileSync(Path.join(state, `file-${index}.json`), `value ${index}`);
  manager.create("manual");
  const copy = vi.spyOn(FS, "copyFileSync");
  const open = vi.spyOn(FS, "openSync");
  const second = manager.create("daily");
  expect(copy).not.toHaveBeenCalled();
  // No source file is opened for hashing; only the manifest and summary are written.
  expect(open.mock.calls.filter(([, flags]) => flags === "r").length).toBeLessThan(5);
  copy.mockRestore();
  open.mockRestore();
  manager.restore(second.id);
  expect(FS.readFileSync(Path.join(state, "file-7.json"), "utf8")).toBe("value 7");
});

it("stores identical contents once and keeps them while any snapshot needs them", () => {
  const { state, backups, manager } = fixture();
  FS.writeFileSync(Path.join(state, "a.txt"), "shared");
  FS.writeFileSync(Path.join(state, "b.txt"), "shared");
  const first = manager.create("manual");
  expect(storedObject(backups, first.id, state, "a.txt")).toBe(
    storedObject(backups, first.id, state, "b.txt"),
  );
  FS.writeFileSync(Path.join(state, "a.txt"), "only in the second snapshot");
  const second = manager.create("manual");
  const onlyFirst = storedObject(backups, first.id, state, "settings.json");
  const onlySecond = storedObject(backups, second.id, state, "a.txt");

  manager.remove(first.id);
  // Content still used by the remaining snapshot survives; nothing else is deleted.
  expect(FS.existsSync(onlyFirst)).toBe(true);
  expect(FS.existsSync(onlySecond)).toBe(true);
  expect(FS.existsSync(storedObject(backups, second.id, state, "b.txt"))).toBe(true);
  FS.writeFileSync(Path.join(state, "b.txt"), "changed");
  manager.restore(second.id);
  expect(FS.readFileSync(Path.join(state, "b.txt"), "utf8")).toBe("shared");
});

it("collects objects that no remaining snapshot references when a snapshot is removed", () => {
  const { state, backups, manager } = fixture();
  const first = manager.create("manual");
  const old = storedObject(backups, first.id, state, "settings.json");
  FS.writeFileSync(Path.join(state, "settings.json"), "replacement");
  manager.create("manual");
  manager.remove(first.id);
  expect(FS.existsSync(old)).toBe(false);
});

it("lists snapshots from their summaries without parsing manifests", () => {
  const { manager } = fixture();
  manager.create("manual");
  manager.create("daily");
  const read = vi.spyOn(FS, "readFileSync");
  expect(manager.list().map((entry) => entry.reason)).toEqual(
    expect.arrayContaining(["manual", "daily"]),
  );
  expect(read.mock.calls.some(([path]) => String(path).endsWith("manifest.json"))).toBe(false);
});

it("still lists and restores a snapshot written in the original full-copy format", () => {
  const { state, profile, backups, manager } = fixture();
  const id = "0b0bf00d-0000-4000-8000-000000000001";
  const roots = manager.roots.map((source, index) => {
    const copy = Path.join(backups, id, String(index));
    FS.cpSync(source, copy, { recursive: true });
    const entries =
      source === state
        ? [{ path: "settings.json", mode: 0o644, size: 12, hash: sha256("old settings") }]
        : [
            {
              path: "Local Storage",
              mode: FS.statSync(Path.join(profile, "Local Storage")).mode & 0o777,
            },
            {
              path: Path.join("Local Storage", "profile"),
              mode: 0o644,
              size: 11,
              hash: sha256("old profile"),
            },
          ];
    for (const entry of entries) FS.chmodSync(Path.join(copy, entry.path), entry.mode);
    return { source, present: true, entries };
  });
  FS.writeFileSync(
    Path.join(backups, id, "manifest.json"),
    JSON.stringify({
      format: 1,
      createdByVersion: "1.0.0",
      id,
      version: "1.0.0",
      createdAt: "2026-11-01T00:00:00.000Z",
      reason: "daily",
      bytes: 23,
      roots,
    }),
  );
  expect(manager.list()).toEqual([expect.objectContaining({ id, reason: "daily" })]);
  // The summary written while listing makes later launches cheap.
  expect(FS.existsSync(Path.join(backups, id, "summary.json"))).toBe(true);
  FS.writeFileSync(Path.join(state, "settings.json"), "new settings");
  manager.restore(id);
  expect(FS.readFileSync(Path.join(state, "settings.json"), "utf8")).toBe("old settings");
});

it("refuses a manifest that would write outside its root, even through a restored link", () => {
  const { state, backups, directory, manager } = fixture();
  const backup = manager.create("manual");
  const manifestPath = Path.join(backups, backup.id, "manifest.json");
  const original = FS.readFileSync(manifestPath, "utf8");
  const hash = JSON.parse(original).roots.find((root: { source: string }) => root.source === state)
    .entries[0].hash;
  for (const forged of [
    [{ path: Path.join("..", "escaped"), mode: 0o644, size: 12, hash }],
    [
      { path: "outside", mode: 0o777, link: directory },
      { path: Path.join("outside", "escaped"), mode: 0o644, size: 12, hash },
    ],
  ]) {
    const manifest = JSON.parse(original);
    manifest.roots.find((root: { source: string }) => root.source === state).entries = forged;
    FS.chmodSync(manifestPath, 0o600);
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => manager.restore(backup.id)).toThrow(/Invalid backup entry/);
    expect(FS.existsSync(Path.join(directory, "escaped"))).toBe(false);
    expect(FS.readFileSync(Path.join(state, "settings.json"), "utf8")).toBe("old settings");
  }
});

it("flushes each newly stored object where flushing is cheap", () => {
  const { state, profile, backups } = fixture();
  for (let index = 0; index < 10; index += 1)
    FS.writeFileSync(Path.join(state, `file-${index}.json`), `value ${index}`);
  const manager = new DataRecovery(backups, [state, profile], "1.0.0", undefined, true);
  const fsync = vi.spyOn(FS, "fsyncSync");
  manager.create("manual");
  expect(fsync.mock.calls.length).toBeGreaterThanOrEqual(12);
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
