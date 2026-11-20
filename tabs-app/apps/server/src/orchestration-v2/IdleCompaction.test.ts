import { describe, expect, it } from "vitest";
import * as DateTime from "effect/DateTime";
import { idleCompactionWindow, type IdleCompactionRecords } from "./IdleCompaction";

const NOW = Date.parse("2026-01-01T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function records(
  overrides: {
    thread?: Record<string, unknown>;
    run?: Record<string, unknown>;
    usage?: Record<string, unknown> | null;
    messageText?: string;
    runtimeRequests?: unknown[];
    contextTransfers?: unknown[];
    providerThread?: Record<string, unknown>;
  } = {},
): IdleCompactionRecords {
  const run = {
    id: "run-1",
    ordinal: 1,
    status: "completed",
    startedAt: DateTime.makeUnsafe(NOW - 600_000),
    completedAt: DateTime.makeUnsafe(NOW - 300_000),
    userMessageId: "msg-1",
    providerThreadId: "pt-1",
    providerInstanceId: "claudeAgent",
    ...overrides.run,
  };
  return {
    thread: {
      id: "thread-1",
      deletedAt: null,
      archivedAt: null,
      settledAt: null,
      settledOverride: null,
      snoozedUntil: null,
      lineage: { relationshipToParent: "root" },
      activeProviderThreadId: "pt-1",
      providerInstanceId: "claudeAgent",
      ...overrides.thread,
    },
    runs: [run],
    messages: [{ id: "msg-1", text: overrides.messageText ?? "please refactor" }],
    providerThreads: [
      {
        id: "pt-1",
        driver: "claudeAgent",
        providerInstanceId: "claudeAgent",
        ...overrides.providerThread,
      },
    ],
    providerTurns:
      overrides.usage === null
        ? []
        : [
            {
              providerThreadId: "pt-1",
              tokenUsage: {
                usedTokens: 150_000,
                promptCacheExpiresAt: iso(NOW + 30 * 60_000),
                updatedAt: iso(NOW - 300_000),
                ...overrides.usage,
              },
            },
          ],
    runtimeRequests: overrides.runtimeRequests ?? [],
    turnItems: [],
    contextTransfers: overrides.contextTransfers ?? [],
  } as never;
}

describe("idleCompactionWindow", () => {
  it("opens two minutes before the cache expires and closes when it does", () => {
    expect(idleCompactionWindow(records(), NOW)).toEqual({
      runId: "run-1",
      startMs: NOW + 28 * 60_000,
      endMs: NOW + 30 * 60_000,
    });
  });

  it("skips small contexts and unknown or expired caches", () => {
    expect(idleCompactionWindow(records({ usage: { usedTokens: 99_999 } }), NOW)).toBeNull();
    expect(
      idleCompactionWindow(records({ usage: { promptCacheExpiresAt: undefined } }), NOW),
    ).toBeNull();
    expect(
      idleCompactionWindow(records({ usage: { promptCacheExpiresAt: iso(NOW - 1) } }), NOW),
    ).toBeNull();
    expect(idleCompactionWindow(records({ usage: null }), NOW)).toBeNull();
  });

  it("skips threads that are archived, settled, snoozed, deleted or not top-level", () => {
    for (const thread of [
      { archivedAt: DateTime.makeUnsafe(NOW) },
      { deletedAt: DateTime.makeUnsafe(NOW) },
      { settledAt: DateTime.makeUnsafe(NOW) },
      { settledOverride: "settled" },
      { snoozedUntil: DateTime.makeUnsafe(NOW + 60_000) },
      { lineage: { relationshipToParent: "subagent" } },
      { lineage: { relationshipToParent: "root", sideChat: true } },
    ])
      expect(idleCompactionWindow(records({ thread }), NOW)).toBeNull();
  });

  it("waits for a finished run and never compacts a compaction", () => {
    expect(idleCompactionWindow(records({ run: { status: "running" } }), NOW)).toBeNull();
    expect(idleCompactionWindow(records({ run: { completedAt: null } }), NOW)).toBeNull();
    expect(idleCompactionWindow(records({ messageText: " /Compact " }), NOW)).toBeNull();
  });

  it("leaves threads with something pending alone", () => {
    expect(
      idleCompactionWindow(records({ runtimeRequests: [{ status: "pending" }] }), NOW),
    ).toBeNull();
    expect(
      idleCompactionWindow(
        records({
          contextTransfers: [{ type: "merge_back", targetThreadId: "thread-1", status: "pending" }],
        }),
        NOW,
      ),
    ).toBeNull();
  });

  it("only compacts a thread that is still on its Claude session", () => {
    expect(idleCompactionWindow(records({ providerThread: { driver: "codex" } }), NOW)).toBeNull();
    expect(
      idleCompactionWindow(records({ thread: { providerInstanceId: "work" } }), NOW),
    ).toBeNull();
    expect(
      idleCompactionWindow(records({ thread: { activeProviderThreadId: "pt-2" } }), NOW),
    ).toBeNull();
  });
});
