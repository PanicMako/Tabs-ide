import { describe, expect, it } from "vitest";

import { initialPiScanState, parseMuseLine, parsePiLine } from "./usagePiMuse.ts";

describe("parsePiLine", () => {
  it("names later records after the session line and reads disjoint counters", () => {
    const state = initialPiScanState();
    expect(parsePiLine(JSON.stringify({ type: "session", id: "sess-1" }), state)).toEqual([]);
    const [record] = parsePiLine(
      JSON.stringify({
        type: "message",
        id: "m1",
        timestamp: "2026-11-01T10:00:00Z",
        message: {
          role: "assistant",
          provider: "anthropic",
          model: "claude-sonnet-5",
          usage: {
            input: 100,
            output: 30,
            cacheRead: 40,
            cacheWrite: 5,
            reasoning: 50,
            cost: { total: 0.02 },
          },
        },
      }),
      state,
    );
    expect(record).toMatchObject({
      provider: "pi",
      sessionId: "sess-1",
      model: "anthropic/claude-sonnet-5",
      totals: {
        uncachedInputTokens: 100,
        cachedInputTokens: 40,
        cacheCreationTokens: 5,
        outputTokens: 30,
        reasoningTokens: 30,
      },
      reportedCostUsd: 0.02,
    });
  });

  it("attributes tool and summary usage without a model and skips empty usage", () => {
    const state = initialPiScanState("fallback");
    const [record] = parsePiLine(
      JSON.stringify({
        type: "compaction",
        id: "c1",
        timestamp: "2026-11-01T10:00:00Z",
        usage: { input: 3, output: 1 },
      }),
      state,
    );
    expect(record).toMatchObject({ model: "Tools/summaries", sessionId: "fallback" });
    expect(
      parsePiLine(
        JSON.stringify({
          type: "compaction",
          id: "c2",
          timestamp: "2026-11-01T10:00:00Z",
          usage: {},
        }),
        state,
      ),
    ).toEqual([]);
    expect(parsePiLine("not json", state)).toEqual([]);
  });
});

describe("parseMuseLine", () => {
  const line = (usage: object, kind = "model_completed") =>
    JSON.stringify({
      schema_version: 1,
      record_type: "event",
      payload_type: "runtime.session",
      payload_schema_version: 1,
      id: "evt-1",
      recorded_at: 1_700_000_000_000_000,
      stream: { kind: "session", id: "session-9" },
      payload: { event: { kind, model: { model_id: "muse-1" }, usage } },
    });

  it("treats cache counters as subsets of input", () => {
    const [record] = parseMuseLine(
      line({
        input_tokens: 100,
        cache_read_tokens: 30,
        cache_write_tokens: 10,
        output_tokens: 20,
        reasoning_tokens: 50,
      }),
    );
    expect(record).toMatchObject({
      provider: "muse",
      sessionId: "session-9",
      model: "muse-1",
      timestampMs: 1_700_000_000_000,
      totals: {
        uncachedInputTokens: 60,
        cachedInputTokens: 30,
        cacheCreationTokens: 10,
        outputTokens: 20,
        reasoningTokens: 20,
      },
    });
  });

  it("ignores other events and empty usage", () => {
    expect(parseMuseLine(line({}))).toEqual([]);
    expect(parseMuseLine(line({ input_tokens: 5 }, "tool_completed"))).toEqual([]);
  });
});
