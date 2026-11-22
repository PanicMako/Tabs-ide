import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_CLEANUP_RULES as DEFAULTS,
  type WorkspaceCleanupEvidence,
  type WorkspaceCleanupRules,
} from "@tabs/contracts";
import { classifyWorktree } from "./classification.ts";
import { usageFor } from "./usage.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 1);

const evidence = (patch: Partial<WorkspaceCleanupEvidence> = {}): WorkspaceCleanupEvidence => ({
  managed: true,
  main: false,
  locked: false,
  missing: false,
  projectRoot: false,
  detached: false,
  error: null,
  branchMerged: false,
  pullRequest: null,
  lastCommitAt: NOW - DAY,
  lastThreadActivityAt: null,
  dirty: false,
  dirtyFileCount: 0,
  ignoredFiles: false,
  unpushedCommits: 0,
  openThreads: 0,
  settledThreads: 0,
  liveSessions: 0,
  runningTerminals: 0,
  lastTerminalActivityAt: null,
  diskBytes: null,
  ...patch,
});
const rules = (patch: Partial<WorkspaceCleanupRules> = {}): WorkspaceCleanupRules => ({
  ...DEFAULTS,
  ...patch,
});
const codes = (result: ReturnType<typeof classifyWorktree>) =>
  result.reasons.map((reason) => reason.code);

describe("classifyWorktree", () => {
  it("keeps a recent, unmerged worktree", () => {
    const result = classifyWorktree(evidence(), rules(), NOW);
    expect(result.verdict).toBe("keep");
    expect(codes(result)).toContain("recent-activity");
  });

  it("marks a merged clean branch safe", () => {
    const result = classifyWorktree(evidence({ branchMerged: true }), rules(), NOW);
    expect(result.verdict).toBe("safe");
    expect(codes(result)).toContain("branch-merged");
  });

  it("honours a merged or closed pull request", () => {
    expect(classifyWorktree(evidence({ pullRequest: "merged" }), rules(), NOW).verdict).toBe(
      "safe",
    );
    expect(classifyWorktree(evidence({ pullRequest: "closed" }), rules(), NOW).verdict).toBe(
      "safe",
    );
    expect(
      classifyWorktree(
        evidence({ pullRequest: "closed" }),
        rules({ removeWhenPullRequestClosed: false }),
        NOW,
      ).verdict,
    ).toBe("keep");
  });

  it("keeps a worktree whose pull request is open even if the branch looks merged", () => {
    const result = classifyWorktree(
      evidence({ pullRequest: "open", branchMerged: true }),
      rules(),
      NOW,
    );
    expect(result.verdict).toBe("keep");
    expect(codes(result)).toContain("pull-request-open");
  });

  it("applies the stale age threshold from the newest activity", () => {
    const old = evidence({ lastCommitAt: NOW - 30 * DAY });
    expect(classifyWorktree(old, rules(), NOW).verdict).toBe("safe");
    expect(classifyWorktree(old, rules({ staleAfterDays: 60 }), NOW).verdict).toBe("keep");
    // A thread turn or terminal output yesterday resets the clock.
    expect(
      classifyWorktree({ ...old, lastThreadActivityAt: NOW - DAY }, rules(), NOW).verdict,
    ).toBe("keep");
    expect(
      classifyWorktree({ ...old, lastTerminalActivityAt: NOW - DAY }, rules(), NOW).verdict,
    ).toBe("keep");
    expect(classifyWorktree(old, rules({ removeWhenStale: false }), NOW).verdict).toBe("keep");
  });

  it("never touches protected checkouts", () => {
    const merged = { branchMerged: true } as const;
    for (const [patch, code] of [
      [{ main: true }, "main-checkout"],
      [{ locked: true }, "locked"],
      [{ projectRoot: true }, "project-root"],
      [{ managed: false }, "not-managed"],
      [{ error: "boom" }, "inspection-failed"],
      [{ missing: true }, "missing-directory"],
    ] as const) {
      const result = classifyWorktree(evidence({ ...merged, ...patch }), rules(), NOW);
      expect(result.verdict).toBe("keep");
      expect(codes(result)).toContain(code);
    }
  });

  it("blocks on open threads, live sessions and running terminals", () => {
    const merged = { branchMerged: true } as const;
    for (const [patch, code] of [
      [{ openThreads: 1 }, "active-thread"],
      [{ liveSessions: 1 }, "live-session"],
      [{ runningTerminals: 2 }, "running-terminal"],
    ] as const) {
      const result = classifyWorktree(evidence({ ...merged, ...patch }), rules(), NOW);
      expect(result.verdict).toBe("keep");
      expect(codes(result)).toContain(code);
    }
    // Settled threads do not block.
    expect(classifyWorktree(evidence({ ...merged, settledThreads: 3 }), rules(), NOW).verdict).toBe(
      "safe",
    );
  });

  it("keeps dirty and unpushed work by default, needs confirmation when the rule is off", () => {
    const merged = { branchMerged: true } as const;
    const dirty = evidence({ ...merged, dirty: true, dirtyFileCount: 2 });
    expect(classifyWorktree(dirty, rules(), NOW).verdict).toBe("keep");
    expect(classifyWorktree(dirty, rules({ keepIfDirty: false }), NOW).verdict).toBe("confirm");

    const unpushed = evidence({ ...merged, unpushedCommits: 3 });
    expect(classifyWorktree(unpushed, rules(), NOW).verdict).toBe("keep");
    expect(classifyWorktree(unpushed, rules({ keepIfUnpushed: false }), NOW).verdict).toBe(
      "confirm",
    );
  });

  it("requires confirmation for irreproducible ignored files", () => {
    const result = classifyWorktree(
      evidence({ branchMerged: true, ignoredFiles: true }),
      rules(),
      NOW,
    );
    expect(result.verdict).toBe("confirm");
  });

  it("does not remove dirty work that no rule selected", () => {
    const result = classifyWorktree(
      evidence({ dirty: true, dirtyFileCount: 1 }),
      rules({ keepIfDirty: false }),
      NOW,
    );
    expect(result.verdict).toBe("keep");
  });

  it("treats an unknown merge state as not merged", () => {
    expect(classifyWorktree(evidence({ branchMerged: null }), rules(), NOW).verdict).toBe("keep");
  });
});

describe("usageFor", () => {
  const index = {
    threads: [
      { path: "/w/a", settled: false, activityAt: 5 },
      { path: "/w/a/sub", settled: true, activityAt: 9 },
      { path: "/w/ab", settled: false, activityAt: 1 },
    ],
    sessionCwds: ["/w/a/src", "/w/ab"],
    terminals: [
      { cwd: "/w/a", running: true, updatedAt: 7 },
      { cwd: "/w/a", running: false, updatedAt: 3 },
    ],
    projectRoots: ["/w/a/project", "/other"],
  };
  it("matches by path boundary, not prefix", () => {
    const usage = usageFor(index, "/w/a");
    expect(usage).toMatchObject({
      openThreads: 1,
      settledThreads: 1,
      liveSessions: 1,
      runningTerminals: 1,
      lastThreadActivityAt: 9,
      lastTerminalActivityAt: 7,
      projectRoot: true,
    });
    expect(usageFor(index, "/w/zzz").openThreads).toBe(0);
  });
});
