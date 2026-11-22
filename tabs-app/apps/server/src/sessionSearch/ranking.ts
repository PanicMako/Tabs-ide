// Query building and result ranking for session search. Pure so it can be unit tested
// without SQLite. Ranking idea follows Orca's session-search-hit-ranking (MIT, (c) 2026
// Lovecast Inc.): lexical relevance first, then recency, with one hit per session.
import type { SessionSearchAgent } from "@tabs/contracts";

const MAX_TERMS = 8;

/** Lowercased alphanumeric terms; the same split FTS5's unicode61 tokenizer applies. */
export function tokenizeQuery(query: string): string[] {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(terms)].slice(0, MAX_TERMS);
}

/**
 * FTS5 MATCH expression: every term must appear (AND), each as a prefix so
 * results show up while typing. Terms are quoted so user input can never inject
 * FTS operators. Returns null when nothing searchable remains.
 */
export function buildMatchExpression(query: string): string | null {
  const terms = tokenizeQuery(query);
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term}"*`).join(" AND ");
}

export interface RawHitRow {
  readonly skey: string;
  readonly agent: SessionSearchAgent;
  readonly sessionId: string;
  readonly cwd: string | null;
  readonly title: string;
  readonly path: string;
  readonly sessionUpdatedAt: number;
  readonly role: "user" | "assistant";
  readonly ts: number | null;
  /** bm25(): lower (more negative) is better. */
  readonly bm25: number;
  readonly snippet: string;
}

export interface RankedHit {
  readonly row: RawHitRow;
  readonly score: number;
  readonly matchCount: number;
}

const DAY_MS = 86_400_000;
const RECENCY_HALF_LIFE_DAYS = 45;

/** 1 for now, 0.5 at the half-life, approaching 0 for very old sessions. */
export function recencyFactor(timestamp: number, now: number): number {
  const ageDays = Math.max(0, now - timestamp) / DAY_MS;
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

/**
 * Collapses message-level matches into one hit per session. A session scores by its best
 * message (relevance), boosted by recency, by the question being in the user's own words,
 * by the query matching the title, and a little by how many messages matched.
 */
export function rankHits(
  rows: ReadonlyArray<RawHitRow>,
  query: string,
  now: number,
  limit: number,
): RankedHit[] {
  const terms = tokenizeQuery(query);
  const bySession = new Map<string, { best: RawHitRow; bestScore: number; count: number }>();
  for (const row of rows) {
    const relevance = -row.bm25;
    const roleBoost = row.role === "user" ? 1.15 : 1;
    const score = Math.max(relevance, 0.0001) * roleBoost;
    const existing = bySession.get(row.skey);
    if (!existing) {
      bySession.set(row.skey, { best: row, bestScore: score, count: 1 });
    } else {
      existing.count += 1;
      if (score > existing.bestScore) {
        existing.best = row;
        existing.bestScore = score;
      }
    }
  }
  const ranked: RankedHit[] = [];
  for (const { best, bestScore, count } of bySession.values()) {
    const title = best.title.toLowerCase();
    const titleHits = terms.filter((term) => title.includes(term)).length;
    const titleBoost = terms.length > 0 ? 1 + 0.4 * (titleHits / terms.length) : 1;
    const countBoost = 1 + Math.min(Math.log2(count), 3) * 0.08;
    const recency = 0.6 + 0.4 * recencyFactor(best.ts ?? best.sessionUpdatedAt, now);
    ranked.push({
      row: best,
      score: bestScore * titleBoost * countBoost * recency,
      matchCount: count,
    });
  }
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      (b.row.ts ?? b.row.sessionUpdatedAt) - (a.row.ts ?? a.row.sessionUpdatedAt),
  );
  return ranked.slice(0, limit);
}
