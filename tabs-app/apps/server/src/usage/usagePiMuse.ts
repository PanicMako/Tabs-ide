/**
 * Pure parsers for Pi and Muse Code session transcripts, in the same
 * line-at-a-time shape as the other providers in `usageTranscripts`.
 *
 * @module usagePiMuse
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { totalTokens, type UsageRecord } from "./usageTranscripts.ts";

const tokenCount = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;

const parseTimestampMs = (value: string): number | null => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const PiUsage = Schema.Struct({
  input: Schema.optional(Schema.Unknown),
  output: Schema.optional(Schema.Unknown),
  cacheRead: Schema.optional(Schema.Unknown),
  cacheWrite: Schema.optional(Schema.Unknown),
  reasoning: Schema.optional(Schema.Unknown),
  cost: Schema.optional(Schema.Struct({ total: Schema.Unknown })),
});
const PiIdentity = { id: Schema.NonEmptyString, timestamp: Schema.String };
const PiModel = { provider: Schema.NonEmptyString, model: Schema.NonEmptyString };
const PiEntry = Schema.Union([
  Schema.Struct({ type: Schema.Literal("session"), id: Schema.NonEmptyString }),
  Schema.Struct({
    ...PiIdentity,
    type: Schema.Literal("message"),
    message: Schema.Union([
      Schema.Struct({
        ...PiModel,
        role: Schema.Literal("assistant"),
        responseModel: Schema.optional(Schema.NonEmptyString),
        usage: PiUsage,
      }),
      Schema.Struct({ role: Schema.Literal("toolResult"), usage: PiUsage }),
    ]),
  }),
  Schema.Struct({ ...PiIdentity, ...PiModel, type: Schema.Literal("usage"), usage: PiUsage }),
  Schema.Struct({
    ...PiIdentity,
    type: Schema.Literals(["compaction", "branch_summary"]),
    usage: PiUsage,
  }),
]);
const decodePiEntry = Schema.decodeUnknownOption(PiEntry);

/** Pi names a session once, in its first line; later lines inherit it. */
export interface PiScanState {
  sessionId: string;
}

export function initialPiScanState(fallbackSessionId = ""): PiScanState {
  return { sessionId: fallbackSessionId };
}

export function parsePiRecord(parsed: unknown, state: PiScanState): readonly UsageRecord[] {
  const decoded = decodePiEntry(parsed);
  if (Option.isNone(decoded)) return [];
  const entry = decoded.value;
  if (entry.type === "session") {
    state.sessionId = entry.id;
    return [];
  }
  const timestampMs = parseTimestampMs(entry.timestamp);
  if (timestampMs === null) return [];
  const source = entry.type === "message" ? entry.message : entry;
  const usage = source.usage;
  // Auxiliary tool/summary records lack model attribution; match Pi's breakdown.
  const rateModel =
    "model" in source
      ? "responseModel" in source
        ? (source.responseModel ?? source.model)
        : source.model
      : undefined;
  const model = "provider" in source ? `${source.provider}/${rateModel}` : "Tools/summaries";
  const outputTokens = tokenCount(usage.output);
  const totals = {
    // Pi's input/cache counters are already disjoint.
    uncachedInputTokens: tokenCount(usage.input),
    cachedInputTokens: tokenCount(usage.cacheRead),
    cacheCreationTokens: tokenCount(usage.cacheWrite),
    outputTokens,
    reasoningTokens: Math.min(outputTokens, tokenCount(usage.reasoning)),
  };
  const cost = usage.cost?.total;
  // Omitted Pi rates default to zero; use shared estimates without positive transcript cost.
  const reportedCostUsd =
    typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? cost : null;
  if (totalTokens(totals) === 0 && reportedCostUsd === null) return [];
  return [
    {
      provider: "pi",
      timestampMs,
      model,
      ...(rateModel === undefined ? {} : { rateModel }),
      sessionId: state.sessionId,
      totals,
      reportedCostUsd,
      speed: "standard",
      // Forks preserve IDs/timestamps; short random IDs need timestamp/model to avoid cross-session collisions.
      dedupeKey: JSON.stringify(["pi", entry.id, entry.timestamp, model]),
    },
  ];
}

export function parsePiLine(line: string, state: PiScanState): readonly UsageRecord[] {
  try {
    return parsePiRecord(JSON.parse(line), state);
  } catch {
    return [];
  }
}

const MuseEntry = Schema.Struct({
  schema_version: Schema.Literal(1),
  record_type: Schema.Literal("event"),
  payload_type: Schema.Literal("runtime.session"),
  // Native automated review completions use session payload version 3.
  payload_schema_version: Schema.Literals([1, 3]),
  id: Schema.NonEmptyString,
  recorded_at: Schema.Number,
  stream: Schema.Struct({ kind: Schema.Literal("session"), id: Schema.NonEmptyString }),
  payload: Schema.Struct({
    source_run_record_id: Schema.optional(Schema.NonEmptyString),
    event: Schema.Struct({
      kind: Schema.Literals(["model_completed", "automated_review_completed"]),
      model: Schema.Union([
        Schema.NonEmptyString,
        Schema.Struct({ model_id: Schema.NonEmptyString }),
      ]),
      usage: Schema.Struct({
        input_tokens: Schema.optional(Schema.Unknown),
        output_tokens: Schema.optional(Schema.Unknown),
        cached_tokens: Schema.optional(Schema.Unknown),
        cached_input_tokens: Schema.optional(Schema.Unknown),
        cache_read_tokens: Schema.optional(Schema.Unknown),
        cache_write_tokens: Schema.optional(Schema.Unknown),
        reasoning_tokens: Schema.optional(Schema.Unknown),
      }),
    }),
  }),
});
const decodeMuseEntry = Schema.decodeUnknownOption(MuseEntry);

export function parseMuseRecord(parsed: unknown): readonly UsageRecord[] {
  const decoded = decodeMuseEntry(parsed);
  if (Option.isNone(decoded)) return [];
  const entry = decoded.value;
  if (!Number.isSafeInteger(entry.recorded_at) || entry.recorded_at < 0) return [];
  const { event } = entry.payload;
  const { usage } = event;
  const input = tokenCount(usage.input_tokens);
  const cachedInputTokens = Math.min(
    input,
    tokenCount(usage.cache_read_tokens ?? usage.cached_input_tokens ?? usage.cached_tokens),
  );
  const cacheCreationTokens = Math.min(
    input - cachedInputTokens,
    tokenCount(usage.cache_write_tokens),
  );
  const outputTokens = tokenCount(usage.output_tokens);
  const totals = {
    // Muse's cache counters are subsets of input; reasoning is a subset of output.
    uncachedInputTokens: input - cachedInputTokens - cacheCreationTokens,
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    reasoningTokens: Math.min(outputTokens, tokenCount(usage.reasoning_tokens)),
  };
  if (totalTokens(totals) === 0) return [];
  return [
    {
      provider: "muse",
      timestampMs: Math.trunc(entry.recorded_at / 1_000),
      model: typeof event.model === "string" ? event.model : event.model.model_id,
      sessionId: entry.stream.id,
      totals,
      reportedCostUsd: null,
      speed: "standard",
      // Runtime envelopes can be copied into another session. The source record
      // identifies the inference even when the enclosing envelope has a new ID.
      dedupeKey: JSON.stringify(["muse", entry.payload.source_run_record_id ?? entry.id]),
    },
  ];
}

export function parseMuseLine(line: string): readonly UsageRecord[] {
  try {
    return parseMuseRecord(JSON.parse(line));
  } catch {
    return [];
  }
}

export const PI_USAGE_FIELDS = {
  type: true,
  id: true,
  timestamp: true,
  provider: true,
  model: true,
  usage: true,
  message: { role: true, provider: true, model: true, responseModel: true, usage: true },
} as const;

export const MUSE_USAGE_FIELDS = {
  schema_version: true,
  record_type: true,
  payload_type: true,
  payload_schema_version: true,
  id: true,
  recorded_at: true,
  stream: { kind: true, id: true },
  payload: { source_run_record_id: true, event: { kind: true, model: true, usage: true } },
} as const;
