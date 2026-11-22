// SQLite FTS5 store for the session-search index. Messages live in an ordinary table with an
// external-content FTS5 index kept in sync by triggers, so replacing one session is a cheap
// indexed delete + insert and queries can join session metadata for filtering.
import type { SessionSearchAgent, SessionSearchQueryInput } from "@tabs/contracts";

import { MARK_END, MARK_START } from "./marks.ts";
import type { ParsedSession } from "./parsers.ts";
import { buildMatchExpression, rankHits, tokenizeQuery, type RawHitRow } from "./ranking.ts";
import type { SqlDatabase } from "./sqliteAdapter.ts";

const SCHEMA_VERSION = "1";
/** FTS candidates fetched before grouping per session; bounds work for broad queries. */
const CANDIDATE_LIMIT = 600;

export interface IndexedFile {
  readonly path: string;
  readonly mtimeMs: number;
  readonly size: number;
  readonly skey: string | null;
}

export interface StoredSession {
  readonly agent: SessionSearchAgent;
  readonly sessionId: string;
  readonly cwd: string | null;
  readonly transcriptPath: string;
}

export interface StoreCounts {
  readonly sessions: number;
  readonly messages: number;
  readonly byAgent: ReadonlyArray<{ agent: SessionSearchAgent; sessions: number }>;
}

export interface StoreHit {
  readonly agent: SessionSearchAgent;
  readonly sessionId: string;
  readonly cwd: string | null;
  readonly title: string;
  readonly timestamp: number;
  readonly role: "user" | "assistant";
  readonly snippet: string;
  readonly score: number;
  readonly matchCount: number;
  readonly transcriptPath: string;
}

export const sessionKey = (agent: SessionSearchAgent, sessionId: string) => `${agent}:${sessionId}`;

export class SessionSearchStore {
  // No parameter properties: this file also runs under Node's type stripping in the worker.
  private readonly db: SqlDatabase;
  readonly ftsAvailable: boolean;

  private constructor(db: SqlDatabase, ftsAvailable: boolean) {
    this.db = db;
    this.ftsAvailable = ftsAvailable;
  }

  static open(db: SqlDatabase): SessionSearchStore {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 3000;");
    const version = SessionSearchStore.readVersion(db);
    if (version !== SCHEMA_VERSION) {
      db.exec(`
        DROP TABLE IF EXISTS messages_fts;
        DROP TABLE IF EXISTS messages;
        DROP TABLE IF EXISTS sessions;
        DROP TABLE IF EXISTS files;
        DROP TABLE IF EXISTS meta;
      `);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY, agent TEXT NOT NULL, mtime_ms REAL NOT NULL,
        size INTEGER NOT NULL, skey TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        skey TEXT PRIMARY KEY, agent TEXT NOT NULL, session_id TEXT NOT NULL, cwd TEXT,
        title TEXT NOT NULL, started_at REAL, updated_at REAL NOT NULL, path TEXT NOT NULL,
        message_count INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_updated ON sessions(updated_at DESC);
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY, skey TEXT NOT NULL, role TEXT NOT NULL, ts REAL, text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_skey ON messages(skey);
    `);
    db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema', ?)").run(SCHEMA_VERSION);
    let ftsAvailable = true;
    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          text, content='messages', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
        );
        CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
        END;
      `);
    } catch {
      ftsAvailable = false;
    }
    return new SessionSearchStore(db, ftsAvailable);
  }

  private static readVersion(db: SqlDatabase): string | null {
    try {
      const row = db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as
        | { value: string }
        | undefined;
      return row?.value ?? null;
    } catch {
      return null;
    }
  }

  close() {
    this.db.close();
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string) {
    this.db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)").run(key, value);
  }

  clear() {
    this.transaction(() => {
      this.db.exec("DELETE FROM messages; DELETE FROM sessions; DELETE FROM files;");
      this.db.exec("DELETE FROM meta WHERE key != 'schema';");
      if (this.ftsAvailable)
        this.db.exec("INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');");
    });
  }

  private transaction<T>(body: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = body();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listFiles(agent: SessionSearchAgent): Map<string, IndexedFile> {
    const rows = this.db
      .prepare("SELECT path, mtime_ms, size, skey FROM files WHERE agent = ?")
      .all(agent) as ReadonlyArray<{
      path: string;
      mtime_ms: number;
      size: number;
      skey: string | null;
    }>;
    return new Map(
      rows.map((row) => [
        row.path,
        { path: row.path, mtimeMs: row.mtime_ms, size: row.size, skey: row.skey },
      ]),
    );
  }

  /** Records a file as seen (even when it yielded no session) so unchanged files are skipped. */
  markFile(agent: SessionSearchAgent, file: Omit<IndexedFile, "skey">, skey: string | null) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO files(path, agent, mtime_ms, size, skey) VALUES (?, ?, ?, ?, ?)",
      )
      .run(file.path, agent, file.mtimeMs, file.size, skey);
  }

  /** Replaces one session atomically: metadata, messages (and, via triggers, the FTS rows). */
  upsertSession(
    session: ParsedSession,
    transcriptPath: string,
    file: Omit<IndexedFile, "skey"> | null,
  ) {
    const skey = sessionKey(session.agent, session.sessionId);
    this.transaction(() => {
      this.deleteSessionRows(skey);
      const updatedAt = session.updatedAt ?? file?.mtimeMs ?? Date.now();
      this.db
        .prepare(
          `INSERT INTO sessions(skey, agent, session_id, cwd, title, started_at, updated_at, path, message_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          skey,
          session.agent,
          session.sessionId,
          session.cwd,
          session.title,
          session.startedAt,
          updatedAt,
          transcriptPath,
          session.messages.length,
        );
      const insert = this.db.prepare(
        "INSERT INTO messages(skey, role, ts, text) VALUES (?, ?, ?, ?)",
      );
      for (const message of session.messages)
        insert.run(skey, message.role, message.ts, message.text);
      if (file) this.markFile(session.agent, file, skey);
    });
  }

  private deleteSessionRows(skey: string) {
    this.db.prepare("DELETE FROM messages WHERE skey = ?").run(skey);
    this.db.prepare("DELETE FROM sessions WHERE skey = ?").run(skey);
  }

  removeFile(path: string) {
    const row = this.db.prepare("SELECT skey FROM files WHERE path = ?").get(path) as
      | { skey: string | null }
      | undefined;
    this.transaction(() => {
      if (row?.skey) {
        // A session id can be re-homed to a newer file; only drop it if this file still owns it.
        const owner = this.db.prepare("SELECT path FROM sessions WHERE skey = ?").get(row.skey) as
          | { path: string }
          | undefined;
        if (owner?.path === path) this.deleteSessionRows(row.skey);
      }
      this.db.prepare("DELETE FROM files WHERE path = ?").run(path);
    });
  }

  counts(): StoreCounts {
    const sessions = this.db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number };
    const messages = this.db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number };
    const byAgent = this.db
      .prepare("SELECT agent, COUNT(*) AS n FROM sessions GROUP BY agent")
      .all() as ReadonlyArray<{ agent: SessionSearchAgent; n: number }>;
    return {
      sessions: sessions.n,
      messages: messages.n,
      byAgent: byAgent.map((row) => ({ agent: row.agent, sessions: row.n })),
    };
  }

  getSession(agent: SessionSearchAgent, sessionId: string): StoredSession | null {
    const row = this.db
      .prepare("SELECT agent, session_id, cwd, path FROM sessions WHERE skey = ?")
      .get(sessionKey(agent, sessionId)) as
      | { agent: SessionSearchAgent; session_id: string; cwd: string | null; path: string }
      | undefined;
    return row
      ? { agent: row.agent, sessionId: row.session_id, cwd: row.cwd, transcriptPath: row.path }
      : null;
  }

  getMessages(
    agent: SessionSearchAgent,
    sessionId: string,
  ): Array<{ role: "user" | "assistant"; text: string; ts: number | null }> {
    return this.db
      .prepare("SELECT role, text, ts FROM messages WHERE skey = ? ORDER BY id")
      .all(sessionKey(agent, sessionId)) as Array<{
      role: "user" | "assistant";
      text: string;
      ts: number | null;
    }>;
  }

  query(input: SessionSearchQueryInput, now: number): StoreHit[] {
    const limit = input.limit ?? 30;
    const filters: string[] = [];
    const params: unknown[] = [];
    if (input.agents && input.agents.length > 0) {
      filters.push(`s.agent IN (${input.agents.map(() => "?").join(",")})`);
      params.push(...input.agents);
    }
    const cwd = input.cwd?.trim();
    if (cwd) {
      filters.push("s.cwd LIKE ? ESCAPE '\\'");
      params.push(`%${cwd.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    if (input.since !== undefined) {
      filters.push("COALESCE(m.ts, s.updated_at) >= ?");
      params.push(input.since);
    }
    if (input.until !== undefined) {
      filters.push("COALESCE(m.ts, s.updated_at) <= ?");
      params.push(input.until);
    }
    const match = buildMatchExpression(input.query);
    if (match === null) return this.recentSessions(input, limit);
    const where = filters.length > 0 ? ` AND ${filters.join(" AND ")}` : "";
    const rows = this.ftsAvailable
      ? (this.db
          .prepare(
            `SELECT m.skey AS skey, s.agent AS agent, s.session_id AS sessionId, s.cwd AS cwd,
                    s.title AS title, s.path AS path, s.updated_at AS sessionUpdatedAt,
                    m.role AS role, m.ts AS ts, bm25(messages_fts) AS bm25,
                    snippet(messages_fts, 0, '${MARK_START}', '${MARK_END}', '…', 24) AS snippet
             FROM messages_fts
             JOIN messages m ON m.id = messages_fts.rowid
             JOIN sessions s ON s.skey = m.skey
             WHERE messages_fts MATCH ?${where}
             ORDER BY bm25(messages_fts) LIMIT ${CANDIDATE_LIMIT}`,
          )
          .all(match, ...params) as RawHitRow[])
      : this.likeFallback(input.query, where, params);
    return rankHits(rows, input.query, now, limit).map(({ row, score, matchCount }) => ({
      agent: row.agent,
      sessionId: row.sessionId,
      cwd: row.cwd,
      title: row.title,
      timestamp: row.ts ?? row.sessionUpdatedAt,
      role: row.role,
      snippet: row.snippet,
      score,
      matchCount,
      transcriptPath: row.path,
    }));
  }

  /** Used only if this SQLite build lacks FTS5: AND of LIKE terms, newest first. */
  private likeFallback(query: string, where: string, params: unknown[]): RawHitRow[] {
    const terms = tokenizeQuery(query);
    const likes = terms.map(() => "m.text LIKE ? ESCAPE '\\'").join(" AND ");
    const rows = this.db
      .prepare(
        `SELECT m.skey AS skey, s.agent AS agent, s.session_id AS sessionId, s.cwd AS cwd,
                s.title AS title, s.path AS path, s.updated_at AS sessionUpdatedAt,
                m.role AS role, m.ts AS ts, 0 AS bm25, m.text AS snippet
         FROM messages m JOIN sessions s ON s.skey = m.skey
         WHERE ${likes}${where} ORDER BY COALESCE(m.ts, s.updated_at) DESC LIMIT ${CANDIDATE_LIMIT}`,
      )
      .all(...terms.map((t) => `%${t}%`), ...params) as RawHitRow[];
    return rows.map((row) => ({
      ...row,
      bm25: -1,
      snippet: markSnippet(row.snippet, terms),
    }));
  }

  private recentSessions(input: SessionSearchQueryInput, limit: number): StoreHit[] {
    const filters: string[] = [];
    const params: unknown[] = [];
    if (input.agents && input.agents.length > 0) {
      filters.push(`agent IN (${input.agents.map(() => "?").join(",")})`);
      params.push(...input.agents);
    }
    const cwd = input.cwd?.trim();
    if (cwd) {
      filters.push("cwd LIKE ? ESCAPE '\\'");
      params.push(`%${cwd.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    if (input.since !== undefined) {
      filters.push("updated_at >= ?");
      params.push(input.since);
    }
    if (input.until !== undefined) {
      filters.push("updated_at <= ?");
      params.push(input.until);
    }
    const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT agent, session_id AS sessionId, cwd, title, path, updated_at AS updatedAt,
                message_count AS messageCount FROM sessions ${where}
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(...params, limit) as ReadonlyArray<{
      agent: SessionSearchAgent;
      sessionId: string;
      cwd: string | null;
      title: string;
      path: string;
      updatedAt: number;
      messageCount: number;
    }>;
    return rows.map((row) => ({
      agent: row.agent,
      sessionId: row.sessionId,
      cwd: row.cwd,
      title: row.title,
      timestamp: row.updatedAt,
      role: "user" as const,
      snippet: row.title,
      score: 0,
      matchCount: row.messageCount,
      transcriptPath: row.path,
    }));
  }
}

/** Builds a ~160 char window around the first term hit with match markers (fallback path). */
export function markSnippet(text: string, terms: ReadonlyArray<string>): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index !== -1 && (at === -1 || index < at)) at = index;
  }
  const start = Math.max(0, at - 60);
  const window = text.slice(start, start + 180).replace(/\s+/g, " ");
  let marked = window;
  for (const term of terms) {
    marked = marked.replace(
      new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
      (hit) => `${MARK_START}${hit}${MARK_END}`,
    );
  }
  return `${start > 0 ? "…" : ""}${marked}${start + 180 < text.length ? "…" : ""}`;
}
