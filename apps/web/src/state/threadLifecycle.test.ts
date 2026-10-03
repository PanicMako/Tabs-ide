import { describe, expect, it } from "vitest";
import type { ThreadId } from "@tabs/contracts";
import {
  isSettled,
  isSnoozed,
  lifecycleFor,
  readThreadLifecycleSnapshot,
  threadLifecycleActions,
  type ThreadLifecycleEntry,
} from "./threadLifecycle";

const entry = (overrides: Partial<ThreadLifecycleEntry>): ThreadLifecycleEntry => ({
  pinnedAt: null,
  settledAt: null,
  snoozedUntil: null,
  ...overrides,
});

describe("thread lifecycle classification", () => {
  it("keeps a future snooze hidden and wakes an expired snooze", () => {
    expect(
      isSnoozed(
        entry({ snoozedUntil: "2026-09-01T12:00:00.000Z" }),
        Date.parse("2026-09-01T11:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isSnoozed(
        entry({ snoozedUntil: "2026-09-01T12:00:00.000Z" }),
        Date.parse("2026-09-01T12:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("clears expired snoozes and records the scheduled wake", () => {
    const threadId = "thread-expired-snooze" as ThreadId;
    threadLifecycleActions.snooze(threadId, "2026-09-01T12:00:00.000Z");

    threadLifecycleActions.expireSnoozes(Date.parse("2026-09-01T12:00:01.000Z"));

    const lifecycle = lifecycleFor(readThreadLifecycleSnapshot(), threadId);
    expect(lifecycle.snoozedUntil).toBeNull();
    expect(lifecycle.lastTransition?.reason).toBe("Woke on schedule");
  });

  it("returns settled work to active when newer thread activity arrives", () => {
    expect(
      isSettled(entry({ settledAt: "2026-09-01T12:00:00.000Z" }), "2026-09-01T11:59:00.000Z"),
    ).toBe(true);
    expect(
      isSettled(entry({ settledAt: "2026-09-01T12:00:00.000Z" }), "2026-09-01T12:01:00.000Z"),
    ).toBe(false);
  });
});
