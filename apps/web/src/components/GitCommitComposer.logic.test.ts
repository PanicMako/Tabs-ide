import type { GitBranch, GitListBranchesResult, GitStatusResult } from "@tabs/contracts";
import { describe, expect, it } from "vitest";

import {
  buildGitCommitComposerState,
  resolveGitPrimaryActionState,
} from "./GitCommitComposer.logic";

function createStatus(overrides: Partial<GitStatusResult> = {}): GitStatusResult {
  return {
    branch: "feature/example",
    hasWorkingTreeChanges: false,
    workingTree: {
      files: [],
      insertions: 0,
      deletions: 0,
    },
    staged: {
      files: [],
      insertions: 0,
      deletions: 0,
    },
    unstaged: {
      files: [],
      insertions: 0,
      deletions: 0,
    },
    conflicted: {
      files: [],
    },
    untracked: {
      files: [],
    },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    operation: null,
    pr: null,
    ...overrides,
  };
}

function createBranchList(input?: Partial<GitListBranchesResult>): GitListBranchesResult {
  const branches: GitBranch[] = [
    {
      name: "feature/example",
      current: true,
      isDefault: false,
      isRemote: false,
      worktreePath: null,
    },
  ];

  return {
    branches,
    isRepo: true,
    hasOriginRemote: true,
    ...input,
  };
}

describe("Git commit composer", () => {
  it("is stage-first for commit actions", () => {
    const state = buildGitCommitComposerState({
      gitStatus: createStatus({
        hasWorkingTreeChanges: true,
        workingTree: {
          files: [
            {
              path: "src/app.tsx",
              staged: false,
              unstaged: true,
              conflicted: false,
              untracked: false,
              insertions: 4,
              deletions: 1,
            },
          ],
          insertions: 4,
          deletions: 1,
        },
      }),
      branchList: createBranchList(),
      isBusy: false,
      stagedCount: 0,
    });

    expect(state.actions[0]).toMatchObject({
      id: "commit",
      disabled: true,
      disabledReason: "Stage files in Changes first.",
    });
    expect(state.actions[1]).toMatchObject({
      id: "commit_push",
      disabled: true,
      disabledReason: "Stage files in Changes first.",
    });
  });

  it("disables commit flows for a clean tree with no local commits ahead", () => {
    const state = buildGitCommitComposerState({
      gitStatus: createStatus(),
      branchList: createBranchList(),
      isBusy: false,
      stagedCount: 0,
    });

    expect(state.actions[0]).toMatchObject({
      id: "commit",
      disabled: true,
      disabledReason: "Nothing staged for a commit.",
    });
    expect(state.actions[1]).toMatchObject({
      id: "commit_push",
      disabled: true,
      disabledReason: "No local commits to push.",
    });
    expect(state.actions[2]).toMatchObject({
      id: "commit_push_pr",
      disabled: true,
      disabledReason: "No local commits to include in a PR.",
    });
  });

  it("keeps plain commit available on detached HEAD while blocking push and PR", () => {
    const state = buildGitCommitComposerState({
      gitStatus: createStatus({ branch: null }),
      branchList: createBranchList(),
      isBusy: false,
      stagedCount: 2,
    });

    expect(state.actions[0]).toMatchObject({
      id: "commit",
      disabled: false,
    });
    expect(state.actions[1]).toMatchObject({
      id: "commit_push",
      disabled: true,
      disabledReason: "Detached HEAD: checkout a branch before pushing.",
    });
    expect(state.actions[2]).toMatchObject({
      id: "commit_push_pr",
      disabled: true,
      disabledReason: "Detached HEAD: checkout a branch before creating a PR.",
    });
  });

  it("disables push and PR flows while the branch is behind upstream", () => {
    const state = buildGitCommitComposerState({
      gitStatus: createStatus({
        hasWorkingTreeChanges: true,
        behindCount: 2,
      }),
      branchList: createBranchList(),
      isBusy: false,
      stagedCount: 1,
    });

    expect(state.actions[0]).toMatchObject({
      id: "commit",
      disabled: false,
    });
    expect(state.actions[1]).toMatchObject({
      id: "commit_push",
      disabled: true,
      disabledReason: "Branch is behind upstream. Pull, merge, or rebase before pushing.",
    });
    expect(state.actions[2]).toMatchObject({
      id: "commit_push_pr",
      disabled: true,
      disabledReason: "Branch is behind upstream. Pull, merge, or rebase before creating a PR.",
    });
  });

  it("blocks push and PR when the repo has no origin remote", () => {
    const state = buildGitCommitComposerState({
      gitStatus: createStatus({
        hasWorkingTreeChanges: true,
        hasUpstream: false,
      }),
      branchList: createBranchList({ hasOriginRemote: false }),
      isBusy: false,
      stagedCount: 1,
    });

    expect(state.actions[1]).toMatchObject({
      id: "commit_push",
      disabled: true,
      disabledReason: 'Add an "origin" remote before pushing.',
    });
    expect(state.actions[2]).toMatchObject({
      id: "commit_push_pr",
      disabled: true,
      disabledReason: 'Add an "origin" remote before creating a PR.',
    });
  });

  it("switches the tertiary action into an existing PR shortcut when one is open", () => {
    const state = buildGitCommitComposerState({
      gitStatus: createStatus({
        pr: {
          state: "open",
          number: 42,
          url: "https://example.com/pr/42",
          title: "Example PR",
          baseBranch: "main",
          headBranch: "feature/example",
        },
      }),
      branchList: createBranchList(),
      isBusy: false,
      stagedCount: 0,
    });

    expect(state.actions[2]).toMatchObject({
      id: "open_pr",
      label: "View PR",
      disabled: false,
    });
  });

  it("surfaces push-only states once staged work is already committed", () => {
    const state = buildGitCommitComposerState({
      gitStatus: createStatus({
        aheadCount: 3,
      }),
      branchList: createBranchList(),
      isBusy: false,
      stagedCount: 0,
    });

    expect(state.actions[1]).toMatchObject({
      id: "commit_push",
      label: "Push Branch",
      disabled: false,
    });
    expect(state.actions[2]).toMatchObject({
      id: "commit_push_pr",
      label: "Push & Create PR",
      disabled: false,
    });
  });

  it("derives the basic primary action from the first enabled composer action", () => {
    const state = buildGitCommitComposerState({
      gitStatus: createStatus({
        hasWorkingTreeChanges: true,
      }),
      branchList: createBranchList(),
      isBusy: false,
      stagedCount: 1,
    });

    const primary = resolveGitPrimaryActionState(state);
    expect(primary).toMatchObject({
      id: "commit",
      label: "Commit Staged",
      disabled: false,
      disabledReason: null,
    });
  });

  it("marks composer actions as safe and available in both modes", () => {
    const state = buildGitCommitComposerState({
      gitStatus: createStatus({
        hasWorkingTreeChanges: true,
      }),
      branchList: createBranchList(),
      isBusy: false,
      stagedCount: 1,
    });

    for (const action of state.actions) {
      expect(action.modeAvailability).toBe("both");
      expect(action.riskLevel).toBe("safe");
    }
  });
});
