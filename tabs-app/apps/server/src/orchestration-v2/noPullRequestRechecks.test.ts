import { describe, expect, it } from "vitest";
import { makeNoPullRequestRechecks } from "./noPullRequestRechecks.ts";

const MINUTE = 60_000;
const NOW = Date.parse("2026-11-14T00:00:00Z");

describe("noPullRequestRechecks", () => {
  it("looks up at most four never-read branches per sweep, newest activity first", () => {
    const rechecks = makeNoPullRequestRechecks();
    const branches = Array.from({ length: 10 }, (_, index) => ({
      key: `branch-${index}`,
      activityAtMs: NOW - index * MINUTE,
    }));
    const first = rechecks.select(NOW, branches);
    expect([...first]).toEqual(["branch-0", "branch-1", "branch-2", "branch-3"]);
    const second = rechecks.select(NOW + MINUTE, branches);
    expect([...second]).toEqual(["branch-4", "branch-5", "branch-6", "branch-7"]);
  });

  it("waits half an hour before rereading a recent branch without a pull request", () => {
    const rechecks = makeNoPullRequestRechecks();
    const branch = [{ key: "feature", activityAtMs: NOW }];
    expect(rechecks.select(NOW, branch).size).toBe(1);
    expect(rechecks.select(NOW + 29 * MINUTE, branch).size).toBe(0);
    expect(rechecks.select(NOW + 31 * MINUTE, branch).size).toBe(1);
  });

  it("always looks up a branch that last had a pull request", () => {
    const rechecks = makeNoPullRequestRechecks();
    rechecks.record("open-branch", NOW, true);
    const selected = rechecks.select(NOW + MINUTE, [{ key: "open-branch", activityAtMs: NOW }]);
    expect(selected.has("open-branch")).toBe(true);
  });

  it("rereads long-idle branches less often than recent ones", () => {
    const rechecks = makeNoPullRequestRechecks();
    const idle = [{ key: "old", activityAtMs: NOW - 24 * 60 * MINUTE }];
    rechecks.select(NOW, idle);
    expect(rechecks.select(NOW + 90 * MINUTE, idle).size).toBe(0);
    expect(rechecks.select(NOW + 140 * MINUTE, idle).size).toBe(1);
  });

  it("forgets branches that no longer exist", () => {
    const rechecks = makeNoPullRequestRechecks();
    rechecks.record("gone", NOW, false);
    rechecks.retain(new Set(["other"]));
    expect(rechecks.select(NOW + MINUTE, [{ key: "gone", activityAtMs: NOW }]).size).toBe(1);
  });
});
