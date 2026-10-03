import { describe, expect, it } from "vitest";
import { deriveRepoState, type DeriveRepoStateParams } from "./deriveRepoState";

const defaultParams: DeriveRepoStateParams = {
  isGitInstalled: true,
  isRepo: true,
  hasConflict: false,
  conflictedFilesCount: 0,
  stagedFilesCount: 0,
  unstagedFilesCount: 0,
  operationState: null,
  isEmptyRepo: false,
  isDetached: false,
  hasRemote: true,
  remoteName: "origin",
  ghAuthed: true,
  pushAccess: "write",
  aheadCount: 0,
  behindCount: 0,
};

describe("deriveRepoState — Isolated State Tests", () => {
  it("1. git_not_installed", () => {
    const res = deriveRepoState({ ...defaultParams, isGitInstalled: false });
    expect(res.kind).toBe("git_not_installed");
    expect(res.canCommitLocally).toBe(false);
    expect(res.canPush).toBe(false);
  });

  it("2. not_a_repo", () => {
    const res = deriveRepoState({ ...defaultParams, isRepo: false });
    expect(res.kind).toBe("not_a_repo");
    expect(res.canCommitLocally).toBe(false);
    expect(res.primaryAction?.actionType).toBe("init_repo");
  });

  it("3. rebase_in_progress", () => {
    const res = deriveRepoState({ ...defaultParams, operationState: "rebase" });
    expect(res.kind).toBe("rebase_in_progress");
    expect(res.canCommitLocally).toBe(false);
    expect(res.primaryAction?.actionType).toBe("resolve_conflicts");
  });

  it("4. merge_in_progress (unresolved conflicts)", () => {
    const res = deriveRepoState({
      ...defaultParams,
      hasConflict: true,
      conflictedFilesCount: 2,
      stagedFilesCount: 1,
    });
    expect(res.kind).toBe("merge_in_progress");
    expect(res.canCommitLocally).toBe(false);
    expect(res.commitButtonLabel).toBe("Commit staged");
  });

  it("5. merge_in_progress (all conflicts resolved & staged)", () => {
    const res = deriveRepoState({
      ...defaultParams,
      hasConflict: true,
      conflictedFilesCount: 0,
      stagedFilesCount: 3,
    });
    expect(res.kind).toBe("merge_in_progress");
    expect(res.canCommitLocally).toBe(true);
    expect(res.commitButtonLabel).toBe("Complete merge");
  });

  it("6. cherry_pick_in_progress", () => {
    const res = deriveRepoState({ ...defaultParams, operationState: "cherry-pick" });
    expect(res.kind).toBe("cherry_pick_in_progress");
    expect(res.canCommitLocally).toBe(false);
  });

  it("7. empty_repo", () => {
    const res = deriveRepoState({ ...defaultParams, isEmptyRepo: true, stagedFilesCount: 2 });
    expect(res.kind).toBe("empty_repo");
    expect(res.canCommitLocally).toBe(true);
    expect(res.canPush).toBe(false);
  });

  it("8. detached_head", () => {
    const res = deriveRepoState({ ...defaultParams, isDetached: true, stagedFilesCount: 1 });
    expect(res.kind).toBe("detached_head");
    expect(res.canCommitLocally).toBe(true);
    expect(res.canPush).toBe(false);
    expect(res.canCreatePR).toBe(false);
    expect(res.primaryAction?.actionType).toBe("create_branch");
  });

  it("9. no_remote", () => {
    const res = deriveRepoState({ ...defaultParams, hasRemote: false, stagedFilesCount: 1 });
    expect(res.kind).toBe("no_remote");
    expect(res.canCommitLocally).toBe(true);
    expect(res.canPush).toBe(false);
    expect(res.canCreatePR).toBe(false);
    expect(res.primaryAction?.actionType).toBe("add_remote");
  });

  it("10. gh_not_authenticated", () => {
    const res = deriveRepoState({ ...defaultParams, ghAuthed: false, stagedFilesCount: 1 });
    expect(res.kind).toBe("gh_not_authenticated");
    expect(res.canCommitLocally).toBe(true);
    expect(res.canPush).toBe(false);
    expect(res.canCreatePR).toBe(false);
    expect(res.primaryAction?.actionType).toBe("sign_in_gh");
  });

  it("11. read_only_remote", () => {
    const res = deriveRepoState({ ...defaultParams, pushAccess: "read_only", stagedFilesCount: 1 });
    expect(res.kind).toBe("read_only_remote");
    expect(res.canCommitLocally).toBe(true);
    expect(res.canPush).toBe(false);
    expect(res.canCreatePR).toBe(true);
  });

  it("verifies plain commit enabled while commit & push disabled for no_remote, gh_not_authenticated, read_only_remote", () => {
    for (const params of [
      { ...defaultParams, hasRemote: false, stagedFilesCount: 2 },
      { ...defaultParams, ghAuthed: false, stagedFilesCount: 2 },
      { ...defaultParams, pushAccess: "read_only" as const, stagedFilesCount: 2 },
    ]) {
      const res = deriveRepoState(params);
      expect(res.canCommitLocally).toBe(true);
      expect(res.canPush).toBe(false);

      const commitStagedDisabled = !params.stagedFilesCount || !res.canCommitLocally;
      const commitAndPushDisabled =
        !params.stagedFilesCount || !res.canCommitLocally || !res.canPush;

      expect(commitStagedDisabled).toBe(false);
      expect(commitAndPushDisabled).toBe(true);
    }
  });

  it("12. diverged", () => {
    const res = deriveRepoState({
      ...defaultParams,
      aheadCount: 3,
      behindCount: 2,
      stagedFilesCount: 1,
    });
    expect(res.kind).toBe("diverged");
    expect(res.canCommitLocally).toBe(true);
    expect(res.canPush).toBe(true);
    expect(res.primaryAction?.actionType).toBe("pull_merge");
  });

  it("13. ahead_only", () => {
    const res = deriveRepoState({ ...defaultParams, aheadCount: 2, behindCount: 0 });
    expect(res.kind).toBe("ahead_only");
    expect(res.canPush).toBe(true);
    expect(res.primaryAction?.actionType).toBe("push");
  });

  it("14. clean_ready", () => {
    const res = deriveRepoState({ ...defaultParams });
    expect(res.kind).toBe("clean_ready");
    expect(res.canPush).toBe(true);
    expect(res.canPull).toBe(true);
  });
});

describe("deriveRepoState — Multi-Condition & Priority Order Combination Tests", () => {
  it("Combo 1: Diverged + Read-Only Remote (read_only_remote outranks diverged)", () => {
    const res = deriveRepoState({
      ...defaultParams,
      pushAccess: "read_only",
      aheadCount: 2,
      behindCount: 3,
    });
    expect(res.kind).toBe("read_only_remote");
    expect(res.canPush).toBe(false);
    expect(res.secondaryNotices).toHaveLength(1);
    expect(res.secondaryNotices[0]?.id).toBe("behind_read_only_notice");
    expect(res.secondaryNotices[0]?.message).toContain("behind origin");
  });

  it("Combo 2: Detached HEAD + Merge Conflict (merge_in_progress outranks detached_head)", () => {
    const res = deriveRepoState({
      ...defaultParams,
      isDetached: true,
      hasConflict: true,
      conflictedFilesCount: 1,
    });
    expect(res.kind).toBe("merge_in_progress");
  });

  it("Combo 3: No Remote + Unauthenticated GitHub CLI (no_remote outranks gh_not_authenticated)", () => {
    const res = deriveRepoState({
      ...defaultParams,
      hasRemote: false,
      ghAuthed: false,
    });
    expect(res.kind).toBe("no_remote");
  });

  it("Combo 4: Read-Only Remote + Unauthenticated GitHub CLI (gh_not_authenticated outranks read_only_remote; defensive stale cache notice)", () => {
    // Defensive test: cached pushAccess was read_only from prior session, then user logged out of gh CLI
    const res = deriveRepoState({
      ...defaultParams,
      pushAccess: "read_only",
      ghAuthed: false,
    });
    expect(res.kind).toBe("gh_not_authenticated");
    expect(res.secondaryNotices).toHaveLength(1);
    expect(res.secondaryNotices[0]?.id).toBe("stale_read_only_notice");
  });

  it("Combo 5: Empty Repo + No Remote (empty_repo outranks no_remote)", () => {
    const res = deriveRepoState({
      ...defaultParams,
      isEmptyRepo: true,
      hasRemote: false,
    });
    expect(res.kind).toBe("empty_repo");
    expect(res.secondaryNotices).toHaveLength(1);
    expect(res.secondaryNotices[0]?.id).toBe("no_remote_notice");
  });

  it("Combo 6: Rebase in Progress + Detached HEAD (rebase_in_progress outranks detached_head)", () => {
    const res = deriveRepoState({
      ...defaultParams,
      operationState: "rebase",
      isDetached: true,
    });
    expect(res.kind).toBe("rebase_in_progress");
  });

  it("Combo 7: Detached HEAD + 4 Unpushed Commits (detached_head outranks ahead_only)", () => {
    const res = deriveRepoState({
      ...defaultParams,
      isDetached: true,
      aheadCount: 4,
    });
    expect(res.kind).toBe("detached_head");
    expect(res.canPush).toBe(false);
    expect(res.secondaryNotices).toHaveLength(1);
    expect(res.secondaryNotices[0]?.id).toBe("unpushed_notice");
  });

  it("Combo 8: Clean + 250 Changed Files (clean_ready with large change notice)", () => {
    const res = deriveRepoState({
      ...defaultParams,
      stagedFilesCount: 150,
      unstagedFilesCount: 100,
    });
    expect(res.kind).toBe("clean_ready");
    expect(res.secondaryNotices).toHaveLength(1);
    expect(res.secondaryNotices[0]?.id).toBe("large_change_notice");
  });
});
