import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
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
  const rootIndex = manager.roots.indexOf(state);
  expect(
    FS.readFileSync(Path.join(backups, preserved.id, String(rootIndex), "settings.json"), "utf8"),
  ).toBe("new settings");
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
  const index = manager.roots.indexOf(state);
  FS.writeFileSync(Path.join(backups, backup.id, String(index), "settings.json"), "tampered");
  expect(() => manager.restore(backup.id)).toThrow(/verification failed/);
  expect(FS.readFileSync(Path.join(state, "settings.json"), "utf8")).toBe("old settings");
  expect(manager.list()).toHaveLength(1);
});
it("refuses root substitution and path traversal while preserving links without following them", () => {
  const { state, profile, manager, backups, directory } = fixture();
  expect(() => manager.verify("../../state")).toThrow(/identifier/);
  FS.symlinkSync(Path.join(profile, "Local Storage"), Path.join(state, "external"));
  const backup = manager.create("manual");
  const copiedLink = Path.join(
    backups,
    backup.id,
    String(manager.roots.indexOf(state)),
    "external",
  );
  expect(FS.lstatSync(copiedLink).isSymbolicLink()).toBe(true);
  expect(FS.readlinkSync(copiedLink)).toBe(Path.join(profile, "Local Storage"));
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
  expect(
    FS.readFileSync(
      Path.join(backups, preserved.id, String(newer.roots.indexOf(state)), "settings.json"),
      "utf8",
    ),
  ).toBe("newer history");
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
