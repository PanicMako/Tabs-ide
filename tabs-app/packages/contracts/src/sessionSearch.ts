// Cross-agent session search: one local full-text index over the transcripts
// that external agent CLIs (Claude Code, Codex, Gemini, OpenCode) keep on this
// machine. Concept adapted from Orca (MIT, (c) 2026 Lovecast Inc.) ai-vault-search.
import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const SessionSearchAgent = Schema.Literals(["claude", "codex", "gemini", "opencode"]);
export type SessionSearchAgent = typeof SessionSearchAgent.Type;

export const SESSION_SEARCH_AGENTS: ReadonlyArray<SessionSearchAgent> = [
  "claude",
  "codex",
  "gemini",
  "opencode",
];

export const SessionSearchQueryInput = Schema.Struct({
  query: Schema.String.check(Schema.isMaxLength(300)),
  agents: Schema.optionalKey(Schema.Array(SessionSearchAgent)),
  /** Substring match against the session's working directory. */
  cwd: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1000))),
  /** Inclusive lower bound, epoch milliseconds. */
  since: Schema.optionalKey(Schema.Number),
  /** Inclusive upper bound, epoch milliseconds. */
  until: Schema.optionalKey(Schema.Number),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
});
export type SessionSearchQueryInput = typeof SessionSearchQueryInput.Type;

export const SessionSearchHit = Schema.Struct({
  agent: SessionSearchAgent,
  sessionId: Schema.String,
  cwd: Schema.NullOr(Schema.String),
  title: Schema.String,
  /** Epoch milliseconds of the matched message (or the session when unknown). */
  timestamp: Schema.Number,
  role: Schema.Literals(["user", "assistant"]),
  /** Plain text with match boundaries wrapped in U+E000 / U+E001 markers. */
  snippet: Schema.String,
  score: Schema.Number,
  matchCount: NonNegativeInt,
  transcriptPath: Schema.String,
});
export type SessionSearchHit = typeof SessionSearchHit.Type;

export const SESSION_SEARCH_MARK_START = "";
export const SESSION_SEARCH_MARK_END = "";

export const SessionSearchQueryResult = Schema.Struct({
  hits: Schema.Array(SessionSearchHit),
  /** True while the first (or a refresh) index pass is still running. */
  indexing: Schema.Boolean,
  elapsedMs: Schema.Number,
});
export type SessionSearchQueryResult = typeof SessionSearchQueryResult.Type;

export const SessionSearchStatusInput = Schema.Struct({});
export type SessionSearchStatusInput = typeof SessionSearchStatusInput.Type;

export const SessionSearchAgentStatus = Schema.Struct({
  agent: SessionSearchAgent,
  sessions: NonNegativeInt,
});

export const SessionSearchStatus = Schema.Struct({
  state: Schema.Literals(["idle", "indexing", "error"]),
  sessions: NonNegativeInt,
  messages: NonNegativeInt,
  byAgent: Schema.Array(SessionSearchAgentStatus),
  /** Files still queued for indexing in the current pass. */
  pending: NonNegativeInt,
  lastIndexedAt: Schema.NullOr(Schema.Number),
  error: Schema.NullOr(Schema.String),
});
export type SessionSearchStatus = typeof SessionSearchStatus.Type;

export const SessionSearchReindexInput = Schema.Struct({
  /** Drop the index and rebuild from scratch instead of only changed files. */
  full: Schema.optionalKey(Schema.Boolean),
});
export type SessionSearchReindexInput = typeof SessionSearchReindexInput.Type;

export const SessionSearchResumeInput = Schema.Struct({
  agent: SessionSearchAgent,
  sessionId: TrimmedNonEmptyString,
});
export type SessionSearchResumeInput = typeof SessionSearchResumeInput.Type;

/**
 * How to continue a past session. `command` is a shell command to run in `cwd`
 * (null when the agent CLI has no resume flag); `transcriptPath` always exists.
 */
export const SessionSearchResumeResult = Schema.Struct({
  agent: SessionSearchAgent,
  sessionId: Schema.String,
  cwd: Schema.NullOr(Schema.String),
  command: Schema.NullOr(Schema.String),
  transcriptPath: Schema.NullOr(Schema.String),
});
export type SessionSearchResumeResult = typeof SessionSearchResumeResult.Type;

export const SessionSearchPreviewInput = Schema.Struct({
  agent: SessionSearchAgent,
  sessionId: TrimmedNonEmptyString,
  /** The query that found the session; the window centres on its first match. */
  query: Schema.String.check(Schema.isMaxLength(300)),
});
export type SessionSearchPreviewInput = typeof SessionSearchPreviewInput.Type;

export const SessionSearchPreviewMessage = Schema.Struct({
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String,
  timestamp: Schema.NullOr(Schema.Number),
  /** True when the message contains a query term. */
  matched: Schema.Boolean,
});

/** A slice of one transcript around the first match, for the preview pane. */
export const SessionSearchPreviewResult = Schema.Struct({
  messages: Schema.Array(SessionSearchPreviewMessage),
  totalMessages: NonNegativeInt,
  /** Messages hidden before / after the window. */
  hiddenBefore: NonNegativeInt,
  hiddenAfter: NonNegativeInt,
  /** Lowercased terms the client should highlight. */
  terms: Schema.Array(Schema.String),
});
export type SessionSearchPreviewResult = typeof SessionSearchPreviewResult.Type;

export class SessionSearchError extends Schema.TaggedError<SessionSearchError>()(
  "SessionSearchError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
