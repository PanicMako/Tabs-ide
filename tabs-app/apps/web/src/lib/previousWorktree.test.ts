import { describe, expect, it } from "vitest";
import { previousWorktreeChoice } from "./previousWorktree";

const thread = (over: Record<string, unknown>) =>
  ({
    projectId: "p1",
    environmentId: undefined,
    worktreePath: null,
    branch: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  }) as never;

describe("previousWorktreeChoice", () => {
  it("picks the most recently used other worktree in the project", () => {
    const threads = [
      thread({ worktreePath: "/w/a", branch: "a", updatedAt: "2026-02-01T00:00:00Z" }),
      thread({ worktreePath: "/w/b", branch: "b", updatedAt: "2026-03-01T00:00:00Z" }),
      thread({
        worktreePath: "/w/c",
        branch: "c",
        projectId: "p2",
        updatedAt: "2026-04-01T00:00:00Z",
      }),
    ];
    expect(previousWorktreeChoice(threads, "p1" as never, undefined, "/w/a")).toEqual({
      branch: "b",
      worktreePath: "/w/b",
    });
    expect(previousWorktreeChoice(threads, "p1" as never, undefined, "/w/b")?.worktreePath).toBe(
      "/w/a",
    );
  });

  it("returns null when there is nowhere else to go", () => {
    expect(previousWorktreeChoice([thread({})], "p1" as never, undefined, null)).toBeNull();
    expect(
      previousWorktreeChoice([thread({ worktreePath: "/w/a" })], "p1" as never, undefined, "/w/a"),
    ).toBeNull();
  });
});
