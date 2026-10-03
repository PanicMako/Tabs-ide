import { describe, expect, it } from "vitest";
import { Cause, Effect } from "effect";
import type { GitHubCliShape } from "../Services/GitHubCli.ts";
import {
  runGitHubStackAction,
  decodePullRequestStacksJson,
  type GitHubStackActionError,
} from "../githubStackActions.ts";

const stack = [
  {
    number: 50,
    url: "https://api.github.com/repos/acme/web/stacks/50",
    base: { ref: "main" },
    pull_requests: [
      {
        number: 1,
        title: "Base",
        head: { ref: "base", sha: "aaa" },
        state: "closed",
        merged_at: "2026-01-01T00:00:00Z",
      },
      {
        number: 2,
        title: "Middle",
        head: { ref: "middle", sha: "bbb" },
        state: "open",
        draft: false,
      },
      { number: 3, title: "Top", head: { ref: "top", sha: "ccc" }, state: "open", draft: false },
    ],
  },
];

const input = {
  cwd: "/repo",
  repository: "acme/web",
  host: "github.com",
  number: 3,
  stackNumber: 50,
  expectedStackHeads: [
    { number: 2, headSha: "bbb" },
    { number: 3, headSha: "ccc" },
  ],
  action: "stack_merge" as const,
};

const access = {
  data: {
    repository: {
      pr2: { headRepository: { viewerPermission: "WRITE" }, maintainerCanModify: false },
      pr3: { headRepository: { viewerPermission: "WRITE" }, maintainerCanModify: false },
    },
  },
};

const branch = (number: number, headRefOid: string, behindBy = 1, processed: string[] = []) => ({
  data: {
    processed: processed.map((sha) => ({ headRefOid: sha })),
    repository: {
      pullRequest: { id: `PR_${number}`, headRefOid, baseRef: { compare: { behindBy } } },
    },
  },
});

const rebased = {
  data: { updatePullRequestBranch: { pullRequest: { headRefOid: "rebased-sha" } } },
};
const rebaseResponses = [branch(2, "bbb"), rebased, branch(3, "ccc", 1, ["rebased-sha"]), rebased];

function fakeCli(responses: readonly unknown[]): {
  gitHubCli: GitHubCliShape;
  calls: ReadonlyArray<ReadonlyArray<string>>;
} {
  const calls: Array<ReadonlyArray<string>> = [];
  const execute: GitHubCliShape["execute"] = (req) =>
    Effect.sync(() => {
      calls.push(req.args);
      const value = responses[calls.length - 1];
      if (value === undefined)
        throw new Error(`Unexpected GitHub request #${calls.length}: ${req.args.join(" ")}`);
      return {
        code: 0,
        signal: null,
        timedOut: false,
        stdout: typeof value === "string" ? value : JSON.stringify(value),
        stderr: "",
      };
    });

  const gitHubCli: GitHubCliShape = {
    execute,
    listOpenPullRequests: () => Effect.succeed([]),
    getPullRequest: () => Effect.die(new Error("not implemented")),
    getPullRequestFiles: () => Effect.succeed([]),
    getPullRequestReviewThreads: () => Effect.succeed([]),
    getPullRequestStack: () => Effect.succeed(null),
    mutatePullRequest: () => Effect.void,
    getRepositoryCloneUrls: () => Effect.die(new Error("not implemented")),
    createPullRequest: () => Effect.void,
    getDefaultBranch: () => Effect.succeed("main"),
    checkoutPullRequest: () => Effect.void,
    getAuthStatus: () => Effect.succeed("{}"),
  };

  return { gitHubCli, calls };
}

describe("decodePullRequestStacksJson", () => {
  it("decodes a valid stack with base ref and layers", () => {
    const result = decodePullRequestStacksJson(JSON.stringify(stack));
    expect(result).not.toBeNull();
    expect(result?.number).toBe(50);
    expect(result?.base).toBe("main");
    expect(result?.layers).toHaveLength(3);
    expect(result?.layers[0]?.state).toBe("merged");
    expect(result?.layers[1]?.state).toBe("open");
    expect(result?.layers[2]?.state).toBe("open");
  });

  it("returns null for empty array or invalid json", () => {
    expect(decodePullRequestStacksJson("[]")).toBeNull();
    expect(decodePullRequestStacksJson("")).toBeNull();
    expect(decodePullRequestStacksJson("{")).toBeNull();
  });
});

describe("runGitHubStackAction", () => {
  it("submits one atomic merge with the reviewed head and respects the merge queue", async () => {
    const { gitHubCli, calls } = fakeCli([stack, { status: "enqueued", details: {} }]);
    await Effect.runPromise(
      runGitHubStackAction({
        gitHubCli,
        ...input,
        mergeMethod: "squash",
      }),
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("repos/acme/web/pulls/3/merge-async");
    expect(calls[1]).toContain("sha=ccc");
    expect(calls[1]).toContain("merge_action=default");
    expect(calls[1]).toContain("merge_method=squash");
  });

  it("merges through the selected layer without including later draft layers", async () => {
    const fiveLayers = [
      {
        ...stack[0],
        pull_requests: Array.from({ length: 5 }, (_, index) => ({
          number: index + 1,
          head: { ref: `layer-${index + 1}`, sha: `sha-${index + 1}` },
          state: "open",
          draft: index >= 3,
        })),
      },
    ];
    const { gitHubCli, calls } = fakeCli([fiveLayers, { status: "merged", details: {} }]);
    await Effect.runPromise(
      runGitHubStackAction({
        gitHubCli,
        ...input,
        number: 3,
        expectedStackHeads: [1, 2, 3].map((number) => ({ number, headSha: `sha-${number}` })),
      }),
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("repos/acme/web/pulls/3/merge-async");
    expect(calls[1]).toContain("sha=sha-3");
    expect(calls[1]).toContain("merge_action=default");
  });

  it("rejects stale reviewed heads below a selected middle layer", async () => {
    const { gitHubCli, calls } = fakeCli([stack]);
    const exit = await Effect.runPromiseExit(
      runGitHubStackAction({
        gitHubCli,
        ...input,
        number: 2,
        expectedStackHeads: [{ number: 2, headSha: "old-head" }],
      }),
    );
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const err = Cause.squash(exit.cause) as GitHubStackActionError;
      expect(err._tag).toBe("GitHubStackChangedError");
    }
    expect(calls).toHaveLength(1);
  });

  it("does not merge from an already merged layer", async () => {
    const { gitHubCli, calls } = fakeCli([stack]);
    const exit = await Effect.runPromiseExit(
      runGitHubStackAction({
        gitHubCli,
        ...input,
        number: 1,
        expectedStackHeads: [],
      }),
    );
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const err = Cause.squash(exit.cause) as GitHubStackActionError;
      expect(err._tag).toBe("GitHubStackUnsupportedError");
    }
    expect(calls).toHaveLength(1);
  });

  it("refuses a changed stack before performing any mutation", async () => {
    const { gitHubCli, calls } = fakeCli([stack]);
    const exit = await Effect.runPromiseExit(
      runGitHubStackAction({
        gitHubCli,
        ...input,
        expectedStackHeads: [
          { number: 2, headSha: "old" },
          { number: 3, headSha: "ccc" },
        ],
      }),
    );
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const err = Cause.squash(exit.cause) as GitHubStackActionError;
      expect(err._tag).toBe("GitHubStackChangedError");
    }
    expect(calls).toHaveLength(1);
  });

  it("rebases unmerged layers bottom to top without local git commands", async () => {
    const { gitHubCli, calls } = fakeCli([stack, access, ...rebaseResponses]);
    await Effect.runPromise(
      runGitHubStackAction({
        gitHubCli,
        ...input,
        action: "stack_rebase",
      }),
    );
    const mutations = calls.filter((args) => args.some((arg) => arg.startsWith("query=mutation")));
    expect(mutations).toHaveLength(2);
    expect(mutations[0]).toContain("id=PR_2");
    expect(mutations[0]).toContain("sha=bbb");
    expect(mutations[1]).toContain("id=PR_3");
    expect(mutations[1]).toContain("sha=ccc");
    expect(calls.every((args) => args[0] === "api")).toBe(true);
  });

  it("refuses the entire rebase before mutation when a layer denies write access", async () => {
    const { gitHubCli, calls } = fakeCli([
      stack,
      {
        data: {
          repository: {
            ...access.data.repository,
            pr3: { headRepository: { viewerPermission: "READ" }, maintainerCanModify: false },
          },
        },
      },
    ]);
    const exit = await Effect.runPromiseExit(
      runGitHubStackAction({
        gitHubCli,
        ...input,
        action: "stack_rebase",
      }),
    );
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const err = Cause.squash(exit.cause) as GitHubStackActionError;
      expect(err._tag).toBe("GitHubStackPermissionError");
    }
    expect(calls).toHaveLength(2);
  });

  it("allows a fork that explicitly permits maintainer updates", async () => {
    const { gitHubCli, calls } = fakeCli([
      stack,
      {
        data: {
          repository: {
            ...access.data.repository,
            pr3: { headRepository: { viewerPermission: "READ" }, maintainerCanModify: true },
          },
        },
      },
      ...rebaseResponses,
    ]);
    await Effect.runPromise(
      runGitHubStackAction({
        gitHubCli,
        ...input,
        action: "stack_rebase",
      }),
    );
    expect(calls.at(-1)).toContain("id=PR_3");
  });
});
