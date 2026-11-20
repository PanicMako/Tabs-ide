// node:sqlite reads live conversation databases while Node fs discovers them.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeTimersPromises from "node:timers/promises";

import type { UsageRecord } from "./usageTranscripts.ts";

type FieldValue = number | bigint | Uint8Array;
type Fields = Map<number, FieldValue[]>;

/** Antigravity stores usage metadata as protobuf, independently of conversation text. */
function fields(bytes: Uint8Array): Fields {
  let offset = 0;
  const result: Fields = new Map();
  const varint = () => {
    let value = 0;
    let large: bigint | undefined;
    for (let shift = 0; shift < 70; shift += 7) {
      const byte = bytes[offset++];
      if (byte === undefined || (shift === 63 && byte > 1)) {
        throw new Error("Invalid Antigravity protobuf varint");
      }
      const payload = byte & 127;
      if (large !== undefined) large |= BigInt(payload) << BigInt(shift);
      else {
        const next = value + payload * 2 ** shift;
        if (Number.isSafeInteger(next)) value = next;
        else large = BigInt(value) | (BigInt(payload) << BigInt(shift));
      }
      if (byte < 128) return large ?? value;
    }
    throw new Error("Invalid Antigravity protobuf varint");
  };
  while (offset < bytes.length) {
    const tag = varint();
    if (typeof tag !== "number") throw new Error("Invalid protobuf field");
    const number = Math.floor(tag / 8);
    const wire = tag % 8;
    if (number === 0) throw new Error("Invalid protobuf field");
    let value: FieldValue;
    if (wire === 0) {
      value = varint();
    } else if (wire === 1 || wire === 5 || wire === 2) {
      const length = wire === 2 ? varint() : wire === 1 ? 8 : 4;
      if (typeof length !== "number") throw new Error("Invalid protobuf field length");
      if (length > bytes.length - offset) throw new Error("Truncated protobuf field");
      value = bytes.subarray(offset, offset + length);
      offset += length;
      if (wire !== 2) continue;
    } else {
      throw new Error("Unsupported protobuf wire type");
    }
    const entries = result.get(number) ?? [];
    entries.push(value);
    result.set(number, entries);
  }
  return result;
}

const numberAt = (value: Fields, key: number) => {
  const entry = value.get(key)?.[0];
  return typeof entry === "number" ? entry : 0;
};
const bytesAt = (value: Fields, key: number) => {
  const entry = value.get(key)?.[0];
  return entry instanceof Uint8Array ? entry : undefined;
};
const nested = (value: Fields, key: number) => {
  const bytes = bytesAt(value, key);
  return bytes === undefined ? new Map<number, FieldValue[]>() : fields(bytes);
};
const textAt = (value: Fields, key: number) => {
  const bytes = bytesAt(value, key);
  return bytes === undefined ? "" : new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
};
const timestamp = (value: Fields) => {
  const seconds = numberAt(value, 1);
  return seconds > 0 ? seconds * 1000 + Math.floor(numberAt(value, 2) / 1_000_000) : null;
};

const MODEL_IDS: Record<number, string> = {
  246: "gemini-2.5-pro",
  312: "gemini-2.5-flash",
  313: "gemini-2.5-flash-thinking",
  329: "gemini-2.5-flash-thinking",
  330: "gemini-2.5-flash-lite",
  281: "claude-sonnet-4",
  282: "claude-sonnet-4",
  290: "claude-opus-4",
  291: "claude-opus-4",
  333: "claude-sonnet-4-5",
  334: "claude-sonnet-4-5",
  340: "claude-haiku-4-5",
  341: "claude-haiku-4-5",
  1026: "claude-opus-4-6",
  1035: "claude-sonnet-4-6",
  1016: "gemini-3.1-pro",
  1036: "gemini-3.1-pro",
  1037: "gemini-3.1-pro",
  1018: "gemini-3-flash-preview",
  1084: "gemini-3-flash-preview",
  1047: "gemini-3-flash-preview",
};

function modelName(name: string, id: number): string {
  if (name) {
    const normalized = name
      .toLowerCase()
      .replace(/\s*\([^)]*\)\s*$/, "")
      .replaceAll(" ", "-");
    if (normalized.startsWith("claude-")) {
      return normalized
        .replace(/^claude-(4(?:\.\d+)?)-(sonnet|opus|haiku)/, "claude-$2-$1")
        .replaceAll(".", "-");
    }
    return normalized;
  }
  return MODEL_IDS[id] ?? (id > 0 ? `antigravity-model-${id}` : "");
}

interface Metadata {
  model: string;
  timestampMs: number | null;
  usages: Fields[];
}

function metadata(bytes: Uint8Array, step: boolean): Metadata {
  const root = fields(bytes);
  if (!step && bytesAt(root, 1) === undefined) {
    throw new Error("Missing Antigravity generation metadata");
  }
  const data = step ? root : nested(root, 1);
  const model = step ? nested(data, 24) : data;
  const usage = bytesAt(data, step ? 9 : 4);
  const usages = usage === undefined ? [] : [fields(usage)];
  for (const retry of data.get(step ? 28 : 17) ?? []) {
    if (!(retry instanceof Uint8Array)) throw new Error("Invalid retry metadata");
    const retryUsage = bytesAt(fields(retry), 2);
    if (retryUsage !== undefined) usages.push(fields(retryUsage));
  }
  return {
    model: modelName(
      textAt(model, step ? 12 : 19) || textAt(model, step ? 8 : 21),
      numberAt(model, step ? 1 : 3),
    ),
    timestampMs: step
      ? (timestamp(nested(data, 8)) ?? timestamp(nested(data, 1)))
      : timestamp(nested(nested(data, 9), 4)),
    usages,
  };
}

function blob(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error("Invalid Antigravity metadata blob");
  return value;
}

interface UsageCandidate {
  record: UsageRecord;
  keys: readonly string[];
  timestampQuality: number;
}

async function readDatabase(path: string, fallbackTimestamp: number): Promise<UsageCandidate[]> {
  const db = new NodeSqlite.DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 100; BEGIN");
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    if (!tables.has("gen_metadata") && !tables.has("steps")) {
      throw new Error("Missing Antigravity usage tables");
    }
    const readMetadata = async (query: string, column: string, step: boolean) => {
      const entries: Array<{ idx: number; entry: Metadata }> = [];
      for (const row of db.prepare(query).iterate()) {
        if (typeof row.idx !== "number") throw new Error("Invalid Antigravity metadata index");
        entries.push({ idx: row.idx, entry: metadata(blob(row[column]), step) });
        if (entries.length % 256 === 0) await NodeTimersPromises.setImmediate();
      }
      return entries;
    };
    const generations = tables.has("gen_metadata")
      ? await readMetadata("SELECT idx, data FROM gen_metadata ORDER BY idx", "data", false)
      : [];
    let trajectoryTimestamp: number | null = null;
    if (tables.has("trajectory_metadata_blob")) {
      for (const row of db.prepare("SELECT data FROM trajectory_metadata_blob").iterate()) {
        trajectoryTimestamp ??= timestamp(nested(fields(blob(row.data)), 2));
      }
    }
    const steps = tables.has("steps")
      ? await readMetadata(
          "SELECT idx, metadata FROM steps WHERE metadata IS NOT NULL ORDER BY idx",
          "metadata",
          true,
        )
      : [];
    const sessionId = NodePath.basename(path, ".db");
    const records: UsageCandidate[] = [];
    const generationModels = new Map(generations.map(({ idx, entry }) => [idx, entry.model]));
    for (const [source, entries] of [
      ["step", steps],
      ["generation", generations],
    ] as const) {
      for (const [index, { idx, entry }] of entries.entries()) {
        for (const [usageIndex, usage] of entry.usages.entries()) {
          const outputTokens = Math.max(
            numberAt(usage, 3),
            numberAt(usage, 9) + numberAt(usage, 10),
          );
          const totals = {
            uncachedInputTokens: numberAt(usage, 2),
            cachedInputTokens: numberAt(usage, 5),
            cacheCreationTokens: numberAt(usage, 4),
            outputTokens,
            reasoningTokens: Math.min(outputTokens, numberAt(usage, 9)),
          };
          if (
            totals.uncachedInputTokens +
              totals.cachedInputTokens +
              totals.cacheCreationTokens +
              outputTokens ===
            0
          )
            continue;
          const keys = ([11, 12, 7] as const).flatMap((key) => {
            const id = textAt(usage, key);
            return id ? [`antigravity:${key}:${id}`] : [];
          });
          const record: UsageRecord = {
            provider: "antigravity",
            sessionId,
            timestampMs: entry.timestampMs ?? trajectoryTimestamp ?? fallbackTimestamp,
            model:
              MODEL_IDS[numberAt(usage, 1)] ||
              entry.model ||
              (source === "step" ? generationModels.get(idx) : "") ||
              modelName("", numberAt(usage, 1)) ||
              "antigravity-unknown",
            totals,
            reportedCostUsd: null,
            speed: "standard",
            dedupeKey: keys[0] ?? `antigravity:${sessionId}:${source}:${index}:${usageIndex}`,
          };
          records.push({
            record,
            keys,
            timestampQuality: entry.timestampMs !== null ? 2 : trajectoryTimestamp !== null ? 1 : 0,
          });
        }
      }
    }
    return records;
  } finally {
    db.close();
  }
}

// Cache decoded metadata, never conversation text. Include WAL identity and nanosecond
// modification times so live SQLite writes invalidate a cached snapshot immediately.
const metadataCache = new Map<string, { signature: string; candidates: UsageCandidate[] }>();
const metadataReads = new Map<string, Promise<UsageCandidate[]>>();
let cachedCandidates = 0;
// A step and its generation can both report the same usage. Keep enough raw
// candidates for a large account so sequential scans do not evict the next DB
// before it is visited. The cache remains bounded by candidates and databases.
const MAX_CACHED_CANDIDATES = 1_000_000;
// Heavy users keep several hundred conversations per store. A cap below the
// store size makes the in-order walk evict each database just before the next
// scan reaches it, so every scan decodes everything again.
const MAX_CACHED_DATABASES = 8_192;

/**
 * Last write to a conversation, counting a WAL that has not been checkpointed yet.
 * SQLite recreates an empty WAL whenever a connection opens, including this
 * reader's own, so an empty WAL's mtime says nothing about new usage.
 */
async function lastWriteMs(path: string, databaseMtimeMs: number): Promise<number> {
  try {
    const wal = await NodeFSP.stat(`${path}-wal`);
    return wal.size > 0 ? Math.max(databaseMtimeMs, wal.mtimeMs) : databaseMtimeMs;
  } catch {
    return databaseMtimeMs;
  }
}
let metadataVersion = 0;

const KEY_PREFIX = "antigravity:";

/**
 * One cached candidate, positional to keep the snapshot small: timestamp,
 * model index, the five token totals, identity keys without their shared
 * prefix, timestamp quality, and the dedupe key only when it is not the
 * first identity key (it almost always is).
 */
type SnapshotRow =
  | [number, number, number, number, number, number, number, string[], number]
  | [number, number, number, number, number, number, number, string[], number, string];

/**
 * Decoded usage metadata, never conversation text, keyed by database path and
 * the signature it was read under. A database whose signature no longer
 * matches on the next scan is decoded again, so a stale snapshot costs a
 * re-read, never wrong figures.
 */
export interface AntigravityMetadataSnapshot {
  readonly version: 2;
  readonly models: string[];
  readonly databases: Record<
    string,
    { readonly signature: string; readonly sessionId: string; readonly rows: SnapshotRow[] }
  >;
}

/** Grows whenever a database is decoded, so a caller can tell whether its saved copy is behind. */
export function antigravityMetadataVersion(): number {
  return metadataVersion;
}

export function exportAntigravityMetadata(): AntigravityMetadataSnapshot {
  const models: string[] = [];
  const modelIndex = new Map<string, number>();
  const indexOf = (model: string) => {
    let index = modelIndex.get(model);
    if (index === undefined) {
      index = models.push(model) - 1;
      modelIndex.set(model, index);
    }
    return index;
  };
  const databases: Record<string, AntigravityMetadataSnapshot["databases"][string]> = {};
  for (const [path, { signature, candidates }] of metadataCache) {
    // Keys this reader did not build itself cannot be stored without their prefix.
    if (!candidates.every(({ keys }) => keys.every((key) => key.startsWith(KEY_PREFIX)))) continue;
    databases[path] = {
      signature,
      sessionId: candidates[0]?.record.sessionId ?? "",
      rows: candidates.map(({ record, keys, timestampQuality }): SnapshotRow => {
        const row: SnapshotRow = [
          record.timestampMs,
          indexOf(record.model),
          record.totals.uncachedInputTokens,
          record.totals.cachedInputTokens,
          record.totals.cacheCreationTokens,
          record.totals.outputTokens,
          record.totals.reasoningTokens,
          keys.map((key) => key.slice(KEY_PREFIX.length)),
          timestampQuality,
        ];
        return record.dedupeKey === keys[0] || record.dedupeKey === null
          ? row
          : [...row, record.dedupeKey];
      }),
    };
  }
  return { version: 2, models, databases };
}

const isRow = (row: unknown, modelCount: number): row is SnapshotRow =>
  Array.isArray(row) &&
  (row.length === 9 || (row.length === 10 && typeof row[9] === "string")) &&
  typeof row[0] === "number" &&
  Number.isInteger(row[1]) &&
  row[1] >= 0 &&
  row[1] < modelCount &&
  row.slice(2, 7).every((value) => typeof value === "number" && value >= 0) &&
  Array.isArray(row[7]) &&
  row[7].every((key) => typeof key === "string") &&
  typeof row[8] === "number";

/**
 * Seeds the cache from a saved snapshot. Entries the process already decoded
 * win, and anything malformed is skipped rather than trusted.
 */
export function importAntigravityMetadata(snapshot: unknown): void {
  if (typeof snapshot !== "object" || snapshot === null) return;
  const { version, models, databases } = snapshot as Partial<AntigravityMetadataSnapshot>;
  if (version !== 2 || !Array.isArray(models) || typeof databases !== "object" || !databases) {
    return;
  }
  if (!models.every((model) => typeof model === "string")) return;
  for (const [path, entry] of Object.entries(databases)) {
    if (metadataCache.has(path) || metadataCache.size >= MAX_CACHED_DATABASES) continue;
    if (typeof entry?.signature !== "string" || typeof entry.sessionId !== "string") continue;
    if (!Array.isArray(entry.rows) || !entry.rows.every((row) => isRow(row, models.length))) {
      continue;
    }
    if (cachedCandidates + entry.rows.length > MAX_CACHED_CANDIDATES) continue;
    const candidates = entry.rows.map((row): UsageCandidate => {
      const [timestampMs, model, uncached, cached, creation, output, reasoning, ids, quality] = row;
      const keys = ids.map((id) => KEY_PREFIX + id);
      return {
        record: {
          provider: "antigravity",
          sessionId: entry.sessionId,
          timestampMs,
          model: models[model]!,
          totals: {
            uncachedInputTokens: uncached,
            cachedInputTokens: cached,
            cacheCreationTokens: creation,
            outputTokens: output,
            reasoningTokens: reasoning,
          },
          reportedCostUsd: null,
          speed: "standard",
          dedupeKey: row[9] ?? keys[0] ?? null,
        },
        keys,
        timestampQuality: quality,
      };
    });
    metadataCache.set(path, { signature: entry.signature, candidates });
    cachedCandidates += candidates.length;
  }
}

async function databaseSignature(path: string): Promise<string> {
  const parts = await Promise.all(
    [path, `${path}-wal`].map(async (file) => {
      try {
        const stat = await NodeFSP.stat(file, { bigint: true });
        // SQLite recreates an empty WAL on every open, Antigravity's and ours
        // included; one holding no frames cannot change what the database says.
        if (file !== path && stat.size === 0n) return "empty";
        return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return file === path ? "missing" : "empty";
        }
        throw error;
      }
    }),
  );
  return parts.join("|");
}
async function readCachedDatabase(
  path: string,
  fallbackTimestamp: number,
): Promise<UsageCandidate[]> {
  const signature = await databaseSignature(path);
  const cached = metadataCache.get(path);
  if (cached?.signature === signature) return cached.candidates;
  const key = JSON.stringify([path, signature]);
  const pending = metadataReads.get(key);
  if (pending) return pending;
  const task = (async () => {
    const candidates = await readDatabase(path, fallbackTimestamp);
    if (signature === (await databaseSignature(path))) {
      const previous = metadataCache.get(path);
      if (previous) cachedCandidates -= previous.candidates.length;
      metadataCache.delete(path);
      if (candidates.length <= MAX_CACHED_CANDIDATES) {
        metadataCache.set(path, { signature, candidates });
        cachedCandidates += candidates.length;
        metadataVersion += 1;
        while (
          cachedCandidates > MAX_CACHED_CANDIDATES ||
          metadataCache.size > MAX_CACHED_DATABASES
        ) {
          const oldest = metadataCache.entries().next().value;
          if (!oldest) break;
          cachedCandidates -= oldest[1].candidates.length;
          metadataCache.delete(oldest[0]);
        }
      }
    }
    return candidates;
  })();
  metadataReads.set(key, task);
  try {
    return await task;
  } finally {
    if (metadataReads.get(key) === task) metadataReads.delete(key);
  }
}

/** Reads and merges aliases across every configured Antigravity store before date filtering. */
export async function readAntigravityUsage(
  conversationsDirectories: string | readonly string[],
  sinceMs: number,
) {
  const roots =
    typeof conversationsDirectories === "string"
      ? [conversationsDirectories]
      : conversationsDirectories;
  const files: Array<{ root: string; path: string; records: UsageRecord[] }> = [];
  const errors: string[] = [];
  const identities = new Map<string, number>();
  const groups: Array<
    UsageCandidate & { parent: number; size: number; owner: number; fileIndex: number }
  > = [];
  const find = (index: number): number => {
    let root = index;
    while (groups[root]!.parent !== root) root = groups[root]!.parent;
    while (index !== root) {
      const parent = groups[index]!.parent;
      groups[index]!.parent = root;
      index = parent;
    }
    return root;
  };
  const merge = (left: number, right: number): number => {
    let a = find(left);
    let b = find(right);
    if (a === b) return a;
    if (groups[a]!.size < groups[b]!.size) [a, b] = [b, a];
    const target = groups[a]!;
    const source = groups[b]!;
    const first = target.owner < source.owner ? target : source;
    const bestTime =
      source.timestampQuality > target.timestampQuality ||
      (source.timestampQuality === target.timestampQuality &&
        source.record.timestampMs < target.record.timestampMs)
        ? source
        : target;
    const x = target.record.totals;
    const y = source.record.totals;
    target.record = {
      ...first.record,
      model:
        first.record.model === "antigravity-unknown"
          ? first === target
            ? source.record.model
            : target.record.model
          : first.record.model,
      timestampMs: bestTime.record.timestampMs,
      totals: {
        uncachedInputTokens: Math.max(x.uncachedInputTokens, y.uncachedInputTokens),
        cachedInputTokens: Math.max(x.cachedInputTokens, y.cachedInputTokens),
        cacheCreationTokens: Math.max(x.cacheCreationTokens, y.cacheCreationTokens),
        outputTokens: Math.max(x.outputTokens, y.outputTokens),
        reasoningTokens: Math.max(x.reasoningTokens, y.reasoningTokens),
      },
    };
    target.timestampQuality = bestTime.timestampQuality;
    target.owner = first.owner;
    target.fileIndex = first.fileIndex;
    target.size += source.size;
    source.parent = a;
    return a;
  };
  const append = (candidate: UsageCandidate, fileIndex: number) => {
    const index = groups.length;
    groups.push({ ...candidate, parent: index, size: 1, owner: index, fileIndex });
    for (const key of candidate.keys) {
      const existing = identities.get(key);
      if (existing !== undefined) merge(index, existing);
      identities.set(key, index);
    }
  };
  const visited = new Set<string>();
  const walk = async (directory: string, root: string): Promise<void> => {
    let entries;
    try {
      entries = await NodeFSP.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") errors.push(directory);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = NodePath.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path, root);
      } else if (entry.isFile() && entry.name.endsWith(".db")) {
        try {
          const canonical = await NodeFSP.realpath(path);
          if (visited.has(canonical)) continue;
          visited.add(canonical);
          const stat = await NodeFSP.stat(path);
          // Usage is written as it happens, so a conversation untouched since the
          // window opened holds nothing inside it. Skipping it avoids decoding
          // gigabytes of old history for a short window.
          if ((await lastWriteMs(canonical, stat.mtimeMs)) < sinceMs) continue;
          const candidates = await readCachedDatabase(canonical, stat.mtimeMs);
          const fileIndex = files.length;
          files.push({ root, path, records: [] });
          for (const [index, candidate] of candidates.entries()) {
            append(candidate, fileIndex);
            if (index % 256 === 255) await NodeTimersPromises.setImmediate();
          }
        } catch {
          errors.push(path);
        }
      }
    }
  };
  for (const root of roots) await walk(root, root);
  for (const [index, group] of groups.entries()) {
    if (group.parent === index && group.record.timestampMs >= sinceMs) {
      files[group.fileIndex]!.records.push(group.record);
    }
  }
  return { files, errors };
}
