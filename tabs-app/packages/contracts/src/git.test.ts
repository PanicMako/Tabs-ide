import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  VcsCreateWorktreeInput,
  GitPreparePullRequestThreadInput,
  GitRunStackedActionResult,
  GitRunStackedActionInput,
  GitResolvePullRequestResult,
  GitListPullRequestsInput,
  GitListPullRequestsResult,
  GitRepositoryActionInput,
  GitTriggerReleaseWorkflowInput,
} from "./git.ts";

const decodeCreateWorktreeInput = Schema.decodeUnknownSync(VcsCreateWorktreeInput);
const decodePreparePullRequestThreadInput = Schema.decodeUnknownSync(
  GitPreparePullRequestThreadInput,
);
const decodeRunStackedActionInput = Schema.decodeUnknownSync(GitRunStackedActionInput);
const decodeRunStackedActionResult = Schema.decodeUnknownSync(GitRunStackedActionResult);
const decodeResolvePullRequestResult = Schema.decodeUnknownSync(GitResolvePullRequestResult);
const decodeListPullRequestsInput = Schema.decodeUnknownSync(GitListPullRequestsInput);
const decodeListPullRequestsResult = Schema.decodeUnknownSync(GitListPullRequestsResult);
const decodeRepositoryActionInput = Schema.decodeUnknownSync(GitRepositoryActionInput);
const decodeTriggerReleaseWorkflowInput = Schema.decodeUnknownSync(GitTriggerReleaseWorkflowInput);

describe("GitRepositoryActionInput", () => {
  it("accepts a discriminated repository operation envelope", () => {
    const parsed = decodeRepositoryActionInput({
      cwd: "/repo",
      operation: {
        action: "push_ref",
        remote: "origin",
        ref: "feature/safe-transport",
        forceWithLease: true,
      },
    });

    expect(parsed.operation.action).toBe("push_ref");
  });

  it("rejects operation fields that do not match the discriminator", () => {
    expect(() =>
      decodeRepositoryActionInput({
        cwd: "/repo",
        operation: { action: "remove_remote", ref: "main" },
      }),
    ).toThrow();
  });
});

describe("GitTriggerReleaseWorkflowInput", () => {
  it("keeps workflow arguments as separately validated fields", () => {
    const parsed = decodeTriggerReleaseWorkflowInput({
      cwd: "/repo",
      ref: "main",
      version: "1.3.0",
    });

    expect(parsed).toEqual({ cwd: "/repo", ref: "main", version: "1.3.0" });
  });
});

describe("VcsCreateWorktreeInput", () => {
  it("accepts omitted newRefName for existing-refName worktrees", () => {
    const parsed = decodeCreateWorktreeInput({
      cwd: "/repo",
      refName: "feature/existing",
      path: "/tmp/worktree",
    });

    expect(parsed.newRefName).toBeUndefined();
    expect(parsed.refName).toBe("feature/existing");
  });

  it("accepts baseRefName metadata for a new worktree ref", () => {
    const parsed = decodeCreateWorktreeInput({
      cwd: "/repo",
      refName: "0123456789abcdef",
      newRefName: "feature/new",
      baseRefName: "origin/main",
      path: "/tmp/worktree",
    });

    expect(parsed.baseRefName).toBe("origin/main");
  });
});

describe("GitPreparePullRequestThreadInput", () => {
  it("accepts pull request references and mode", () => {
    const parsed = decodePreparePullRequestThreadInput({
      cwd: "/repo",
      reference: "#42",
      mode: "worktree",
      threadId: "test-thread-id",
    });

    expect(parsed.reference).toBe("#42");
    expect(parsed.mode).toBe("worktree");
    expect(parsed.threadId).toBe("test-thread-id");
  });
});

describe("GitResolvePullRequestResult", () => {
  it("decodes resolved pull request metadata", () => {
    const parsed = decodeResolvePullRequestResult({
      pullRequest: {
        number: 42,
        title: "PR threads",
        url: "https://github.com/pingdotgg/codething-mvp/pull/42",
        baseBranch: "main",
        headBranch: "feature/pr-threads",
        state: "open",
        files: [
          {
            path: "src/app.ts",
            status: "modified",
            additions: 3,
            deletions: 1,
            patch: "@@ -1 +1 @@\n-old\n+new",
            patchTruncated: false,
          },
        ],
      },
    });

    expect(parsed.pullRequest.number).toBe(42);
    expect(parsed.pullRequest.headBranch).toBe("feature/pr-threads");
    expect(parsed.pullRequest.files?.[0]?.path).toBe("src/app.ts");
  });
});

describe("GitListPullRequests", () => {
  it("accepts a bounded list size and a server-authored continuation signal", () => {
    expect(decodeListPullRequestsInput({ cwd: "/repo", state: "open", limit: 100 }).limit).toBe(
      100,
    );
    const result = decodeListPullRequestsResult({
      pullRequests: [],
      hasMore: false,
      capabilities: {
        provider: "gitlab",
        diff: true,
        create: true,
        search: false,
        actions: ["comment", "approve"],
        mergeMethods: ["merge", "squash"],
      },
    });
    expect(result.hasMore).toBe(false);
    expect(result.capabilities?.actions).not.toContain("request_changes");
    expect(() => decodeListPullRequestsInput({ cwd: "/repo", limit: 201 })).toThrow();
  });
});

describe("GitRunStackedActionInput", () => {
  it("accepts explicit stacked actions and requires a client-provided actionId", () => {
    const parsed = decodeRunStackedActionInput({
      actionId: "action-1",
      cwd: "/repo",
      action: "create_pr",
    });

    expect(parsed.actionId).toBe("action-1");
    expect(parsed.action).toBe("create_pr");
  });
});

describe("GitRunStackedActionResult", () => {
  it("decodes a server-authored completion toast", () => {
    const parsed = decodeRunStackedActionResult({
      action: "commit_push",
      branch: {
        status: "created",
        name: "feature/server-owned-toast",
      },
      commit: {
        status: "created",
        commitSha: "89abcdef01234567",
        subject: "feat: move toast state into git manager",
      },
      push: {
        status: "pushed",
        branch: "feature/server-owned-toast",
        upstreamBranch: "origin/feature/server-owned-toast",
      },
      pr: {
        status: "skipped_not_requested",
      },
      toast: {
        title: "Pushed 89abcde to origin/feature/server-owned-toast",
        description: "feat: move toast state into git manager",
        cta: {
          kind: "run_action",
          label: "Create PR",
          action: {
            kind: "create_pr",
          },
        },
      },
    });

    expect(parsed.toast.cta.kind).toBe("run_action");
    if (parsed.toast.cta.kind === "run_action") {
      expect(parsed.toast.cta.action.kind).toBe("create_pr");
    }
  });
});
