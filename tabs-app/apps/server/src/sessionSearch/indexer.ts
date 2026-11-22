// Incremental, mtime-based indexer. Runs inside the worker thread. Files are processed newest
// first and the loop yields to the event loop between files so queries stay responsive.
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

import type { SessionSearchAgent } from "@tabs/contracts";

import { discoverTranscriptFiles, newestFirst, type SessionSearchRoots } from "./discovery.ts";
import {
  buildOpenCodeSession,
  parseClaudeTranscript,
  parseCodexTranscript,
  parseGeminiTranscript,
  type OpenCodePartRow,
  type OpenCodeSessionRow,
  type ParsedSession,
} from "./parsers.ts";
import { openSqlDatabase } from "./sqliteAdapter.ts";
import type { SessionSearchStore } from "./store.ts";

/** Files above this are skipped: they are almost always machine-generated dumps. */
const MAX_FILE_BYTES = 80 * 1024 * 1024;
const OPENCODE_CURSOR_KEY = "opencode.cursor";
const OPENCODE_FILE_KEY = "opencode.db";

export interface IndexProgress {
  readonly pending: number;
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

function idFromPath(path: string): string {
  return basename(path).replace(/\.(jsonl|json)$/, "");
}

export function parseTranscript(
  agent: SessionSearchAgent,
  path: string,
  text: string,
): ParsedSession | null {
  const fallbackId = idFromPath(path);
  switch (agent) {
    case "claude":
      return parseClaudeTranscript(text.split("\n"), fallbackId);
    case "codex": {
      const parsed = parseCodexTranscript(text.split("\n"), fallbackId);
      // Codex file names are `rollout-<timestamp>-<uuid>`; the resume id is the uuid.
      return parsed && parsed.sessionId === fallbackId
        ? { ...parsed, sessionId: fallbackId.replace(/^rollout-[\dT-]+?-(?=[0-9a-f]{8}-)/, "") }
        : parsed;
    }
    case "gemini":
      return parseGeminiTranscript(text, fallbackId);
    case "opencode":
      return null;
  }
}

export interface IndexPassOptions {
  readonly store: SessionSearchStore;
  readonly roots: SessionSearchRoots;
  readonly onProgress?: (progress: IndexProgress) => void;
  readonly shouldAbort?: () => boolean;
}

export async function runIndexPass(options: IndexPassOptions): Promise<void> {
  const { store, roots, onProgress, shouldAbort } = options;
  const discovered = newestFirst(await discoverTranscriptFiles(roots));
  const seen = new Set(discovered.map((file) => file.path));
  const known = new Map<string, ReturnType<SessionSearchStore["listFiles"]>>();
  for (const agent of ["claude", "codex", "gemini"] as const)
    known.set(agent, store.listFiles(agent));

  const stale = discovered.filter((file) => {
    const previous = known.get(file.agent)?.get(file.path);
    return !previous || previous.mtimeMs !== file.mtimeMs || previous.size !== file.size;
  });

  // Drop transcripts that disappeared (deleted/archived by the agent CLI).
  for (const files of known.values()) {
    for (const path of files.keys()) if (!seen.has(path)) store.removeFile(path);
  }

  let pending = stale.length;
  onProgress?.({ pending });
  for (const file of stale) {
    if (shouldAbort?.()) return;
    await indexOneFile(store, file);
    pending -= 1;
    if (pending % 10 === 0) onProgress?.({ pending });
    await yieldToEventLoop();
  }
  onProgress?.({ pending: 0 });
  await indexOpenCode(store, roots.opencodeDb, shouldAbort);
}

async function indexOneFile(
  store: SessionSearchStore,
  file: { agent: "claude" | "codex" | "gemini"; path: string; mtimeMs: number; size: number },
) {
  const marker = { path: file.path, mtimeMs: file.mtimeMs, size: file.size };
  try {
    if (file.size > MAX_FILE_BYTES) {
      store.markFile(file.agent, marker, null);
      return;
    }
    const text = await readFile(file.path, "utf8");
    const session = parseTranscript(file.agent, file.path, text);
    if (session) store.upsertSession(session, file.path, marker);
    else store.markFile(file.agent, marker, null);
  } catch {
    // Unreadable or mid-write: leave it unmarked so the next pass retries.
  }
}

interface OpenCodeSessionDbRow {
  id: string;
  directory: string | null;
  title: string | null;
  time_created: number;
  time_updated: number;
}

/** OpenCode keeps everything in one SQLite file; index sessions updated since the last cursor. */
async function indexOpenCode(
  store: SessionSearchStore,
  dbPath: string,
  shouldAbort: (() => boolean) | undefined,
) {
  let info;
  try {
    info = await stat(dbPath);
  } catch {
    return;
  }
  const signature = `${info.mtimeMs}:${info.size}`;
  const cursor = Number(store.getMeta(OPENCODE_CURSOR_KEY) ?? "0");
  if (store.getMeta(OPENCODE_FILE_KEY) === signature) return;
  let source;
  try {
    source = await openSqlDatabase(dbPath, { readOnly: true });
  } catch {
    return;
  }
  try {
    const sessions = source
      .prepare(
        "SELECT id, directory, title, time_created, time_updated FROM session WHERE time_updated > ? ORDER BY time_updated DESC",
      )
      .all(cursor) as ReadonlyArray<OpenCodeSessionDbRow>;
    const partsQuery = source.prepare(
      `SELECT p.message_id AS messageId, m.data AS messageData, p.data AS partData, p.time_created AS timeCreated
       FROM part p JOIN message m ON m.id = p.message_id
       WHERE p.session_id = ? ORDER BY p.time_created, p.id`,
    );
    let maxUpdated = cursor;
    for (const row of sessions) {
      if (shouldAbort?.()) return;
      const session: OpenCodeSessionRow = {
        id: row.id,
        directory: row.directory,
        title: row.title,
        timeCreated: row.time_created,
        timeUpdated: row.time_updated,
      };
      const parsed = buildOpenCodeSession(
        session,
        partsQuery.all(row.id) as ReadonlyArray<OpenCodePartRow>,
      );
      if (parsed) store.upsertSession(parsed, dbPath, null);
      maxUpdated = Math.max(maxUpdated, row.time_updated);
      await yieldToEventLoop();
    }
    store.setMeta(OPENCODE_CURSOR_KEY, String(maxUpdated));
    store.setMeta(OPENCODE_FILE_KEY, signature);
  } catch {
    // Schema drift or a locked database: skip this pass.
  } finally {
    source.close();
  }
}
