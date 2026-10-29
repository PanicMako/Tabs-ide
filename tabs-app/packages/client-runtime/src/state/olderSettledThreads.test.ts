import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@tabs/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import {
  olderSettledCountKey,
  settledShelfFrontier,
  isListedSettledThread,
  unloadedOlderSettledCount,
  wantedOlderSettledPages,
  type OlderSettled,
  type OlderSettledPages,
} from "./olderSettledThreads.ts";

const DAY = 24 * 60 * 60 * 1000;
const environmentId = EnvironmentId.make("env-a");
const project = ProjectId.make("project-a");
const before = DateTime.formatIso(DateTime.makeUnsafe(50 * DAY));
const older: OlderSettled = {
  before,
  beforeMs: 50 * DAY,
  counts: new Map([[project, 3]]),
};

const row = (
  id: string,
  input: {
    readonly settledDay?: number;
    readonly createdDay?: number;
    readonly subagent?: boolean;
  },
) =>
  ({
    id: ThreadId.make(id),
    projectId: project,
    lineage: {
      parentThreadId: input.subagent === true ? ThreadId.make("parent") : null,
      relationshipToParent: input.subagent === true ? "subagent" : null,
      rootThreadId: ThreadId.make(id),
    },
    settledOverride: input.settledDay === undefined ? null : "settled",
    settledAt: input.settledDay === undefined ? null : DateTime.makeUnsafe(input.settledDay * DAY),
    createdAt: DateTime.makeUnsafe((input.createdDay ?? 1) * DAY),
  }) as unknown as OrchestrationV2ThreadShell;

describe("olderSettledCountKey", () => {
  const key = (
    threads: ReadonlyArray<OrchestrationV2ThreadShell>,
    removedAt: ReadonlyMap<ThreadId, number> = new Map(),
  ) => olderSettledCountKey(threads, older.beforeMs, removedAt);
  const base = [row("kept-old", { settledDay: 10 }), row("open", { createdDay: 60 })];

  it("changes on every event that can change the older count", () => {
    const start = key(base);
    // A removal, even of an id removed before (the map keeps its size).
    expect(key(base, new Map([[ThreadId.make("x"), 4]]))).not.toBe(start);
    expect(key(base, new Map([[ThreadId.make("x"), 9]]))).not.toBe(
      key(base, new Map([[ThreadId.make("x"), 4]])),
    );
    // An omitted thread that arrives unsettled.
    expect(key([...base, row("woken", { createdDay: 5 })])).not.toBe(start);
    // A local row that turns older (a backdated auto-settle).
    expect(key([base[0]!, row("open", { createdDay: 60, settledDay: 20 })])).not.toBe(start);
  });

  it("stays put for new threads and subagents", () => {
    const start = key(base);
    expect(key([...base, row("new", { createdDay: 70 })])).toBe(start);
    expect(key([...base, row("new-settled", { createdDay: 70, settledDay: 71 })])).toBe(start);
    expect(key([...base, row("child", { createdDay: 5, subagent: true })])).toBe(start);
  });
});

describe("settled shelf listing", () => {
  const pages = (frontier: OlderSettledPages["frontier"]): OlderSettledPages => ({
    reads: [],
    frontier,
    status: "ready",
  });
  const at = (day: number) => DateTime.formatIso(DateTime.makeUnsafe(day * DAY));

  it("lists rows at or above the highest frontier still loading", () => {
    // No page yet: the cut is the frontier, so only rows newer than it list.
    const one = settledShelfFrontier([{ older, pages: pages({ settledAt: before }) }]);
    expect(isListedSettledThread(row("recent", { settledDay: 60 }), one)).toBe(true);
    expect(isListedSettledThread(row("old", { settledDay: 30 }), one)).toBe(false);
    // A row that became older inside the loaded range lists at its place.
    const loaded = settledShelfFrontier([{ older, pages: pages({ settledAt: at(20) }) }]);
    expect(isListedSettledThread(row("old", { settledDay: 30 }), loaded)).toBe(true);
    expect(isListedSettledThread(row("older", { settledDay: 10 }), loaded)).toBe(false);
    // All loaded, or a shell that keeps every settled thread: everything lists.
    expect(settledShelfFrontier([{ older, pages: pages(null) }])).toBeNull();
    expect(settledShelfFrontier([{ older: null, pages: pages(null) }])).toBeNull();
  });

  it("holds back another environment's rows below an environment still loading", () => {
    const frontier = settledShelfFrontier([
      { older, pages: pages({ settledAt: at(40) }) },
      { older, pages: pages({ settledAt: at(20) }) },
    ]);
    expect(frontier).toEqual({ settledAt: at(40) });
    expect(isListedSettledThread(row("b-loaded", { settledDay: 30 }), frontier)).toBe(false);
    // A failed environment holds no one back.
    expect(
      settledShelfFrontier([
        { older, pages: { ...pages({ settledAt: at(40) }), status: "failed" } },
        { older, pages: pages({ settledAt: at(20) }) },
      ]),
    ).toEqual({ settledAt: at(20) });
  });

  it("on a settle-time tie, stops at the cursor that admits fewest rows", () => {
    const strict = pages({ settledAt: at(30) });
    const afterM = pages({ settledAt: at(30), threadId: ThreadId.make("m") });
    const afterK = pages({ settledAt: at(30), threadId: ThreadId.make("k") });
    const frontier = (...all: ReadonlyArray<OlderSettledPages>) =>
      settledShelfFrontier(all.map((each) => ({ older, pages: each })));
    expect(frontier(strict, afterM)).toEqual(afterM.frontier);
    expect(frontier(afterM, strict)).toEqual(afterM.frontier);
    expect(frontier(afterM, afterK)).toEqual(afterK.frontier);
  });

  it("follows the server's id order on a settle-time tie", () => {
    const frontier = { settledAt: at(30), threadId: ThreadId.make("m") };
    expect(isListedSettledThread(row("a", { settledDay: 30 }), frontier)).toBe(true);
    expect(isListedSettledThread(row("z", { settledDay: 30 }), frontier)).toBe(false);
  });
});

it("counts older threads the client does not hold, once", () => {
  const local = [
    // Kept by the snapshot (snoozed) and loaded by a page: the server counts both.
    { source: row("snoozed-old", { settledDay: 10 }), environmentId },
    { source: row("paged-old", { settledDay: 20 }), environmentId },
    { source: row("recent", { settledDay: 60 }), environmentId },
  ];
  const olderSettled = () => older;
  expect(
    unloadedOlderSettledCount({
      olderSettled,
      scopes: [{ environmentId, projectIds: null }],
      threads: local,
    }),
  ).toBe(1);
  expect(
    unloadedOlderSettledCount({
      olderSettled,
      scopes: [{ environmentId, projectIds: [ProjectId.make("other")] }],
      threads: local,
    }),
  ).toBe(0);
  // Two projects in one environment: each subtracts only its own loaded rows.
  const other = ProjectId.make("project-b");
  const twoProjects = (): OlderSettled => ({
    ...older,
    counts: new Map([
      [project, 10],
      [other, 10],
    ]),
  });
  expect(
    unloadedOlderSettledCount({
      olderSettled: twoProjects,
      scopes: [{ environmentId, projectIds: [project, other] }],
      threads: [
        { source: row("a-old", { settledDay: 10 }), environmentId },
        { source: { ...row("b-old", { settledDay: 10 }), projectId: other }, environmentId },
      ],
    }),
  ).toBe(18);
});

describe("wantedOlderSettledPages", () => {
  const otherEnvironment = EnvironmentId.make("env-b");
  const full = (settledAt: string): OlderSettledPages => ({
    reads: [],
    frontier: { settledAt, threadId: ThreadId.make("t") },
    status: "ready",
  });
  const wanted = (input: {
    readonly requested?: ReadonlyMap<EnvironmentId, number>;
    readonly environments: ReadonlyMap<EnvironmentId, { readonly pages: OlderSettledPages }>;
    readonly listed: number;
    readonly visible: number;
  }) =>
    wantedOlderSettledPages({
      requested: input.requested ?? new Map(),
      environments: new Map(
        [...input.environments].map(([id, { pages }]) => [id, { older, pages }] as const),
      ),
      listedCount: input.listed,
      visibleCount: input.visible,
    });

  it("reads the next page of the environment holding the shelf back", () => {
    const environments = new Map([
      [environmentId, { pages: full("2026-01-10T00:00:00.000Z") }],
      [otherEnvironment, { pages: full("2026-01-20T00:00:00.000Z") }],
    ]);
    expect(wanted({ environments, listed: 9, visible: 10 })).toEqual(
      new Map([[otherEnvironment, 1]]),
    );
    // A deleted row drops the listed count again.
    expect(
      wanted({ requested: new Map([[environmentId, 1]]), environments, listed: 34, visible: 35 }),
    ).toEqual(
      new Map([
        [environmentId, 1],
        [otherEnvironment, 1],
      ]),
    );
  });

  it("waits for pending pages and stops at a short page or a closed shelf", () => {
    const one = (pages: OlderSettledPages) => new Map([[environmentId, { pages }]]);
    const pending = { ...full(before), status: "pending" as const };
    const requested = new Map([[environmentId, 1]]);
    expect(wanted({ requested, environments: one(pending), listed: 0, visible: 10 })).toBe(
      requested,
    );
    const done = { ...full(before), frontier: null };
    expect(wanted({ requested, environments: one(done), listed: 3, visible: 10 })).toBe(requested);
    expect(wanted({ requested, environments: one(full(before)), listed: 10, visible: 10 })).toBe(
      requested,
    );
    expect(wanted({ requested, environments: one(full(before)), listed: 0, visible: 0 })).toBe(
      requested,
    );
  });
});
