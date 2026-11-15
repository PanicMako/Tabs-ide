import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, expect, vi } from "vitest";

vi.mock("../../processRunner", () => ({
  runProcess: vi.fn(),
}));

import { runProcess } from "../../processRunner";
import { GitHubCli } from "../Services/GitHubCli.ts";
import { clearGitHubDirectCaches } from "../Services/GitHubDirect.ts";
import { decodeGitHubReviewThreads, GitHubCliLive } from "./GitHubCli.ts";

const mockedRunProcess = vi.mocked(runProcess);
const layer = it.layer(GitHubCliLive);

afterEach(() => {
  vi.unstubAllGlobals();
  mockedRunProcess.mockReset();
});

/** Scripted CLI answers, in order, with the direct (in-process) path made to fail first. */
function cliOnly(answers: ReadonlyArray<ReturnType<typeof ok>>) {
  clearGitHubDirectCaches();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("down", { status: 500 })),
  );
  const queue = [...answers];
  mockedRunProcess.mockImplementation(async (command, args) => {
    if (command === "git") throw new Error("not a repository");
    if (args[0] === "auth") throw new Error("no token");
    const next = queue.shift();
    if (next === undefined) throw new Error(`unexpected ${command} ${args.join(" ")}`);
    return next;
  });
}

it("decodes GitHub GraphQL review threads, resolution, and reactions", () => {
  expect(
    decodeGitHubReviewThreads({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  id: "PRRT_thread",
                  path: "src/app.ts",
                  line: 7,
                  diffSide: "RIGHT",
                  isResolved: true,
                  isOutdated: false,
                  comments: {
                    nodes: [
                      {
                        id: "PRRC_root",
                        body: "Please handle the error.",
                        createdAt: "2026-09-01T10:00:00Z",
                        author: { login: "reviewer" },
                        reactionGroups: [
                          {
                            content: "THUMBS_UP",
                            viewerHasReacted: true,
                            users: { totalCount: 2 },
                          },
                        ],
                      },
                      {
                        id: "PRRC_reply",
                        body: "Fixed in the latest commit.",
                        createdAt: "2026-09-01T11:00:00Z",
                        author: { login: "author" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    }),
  ).toMatchObject([
    {
      id: "PRRT_thread",
      path: "src/app.ts",
      line: 7,
      side: "right",
      resolved: true,
      comments: [
        {
          id: "PRRC_root",
          reactions: [{ content: "THUMBS_UP", count: 2, viewerHasReacted: true }],
        },
        { id: "PRRC_reply" },
      ],
    },
  ]);
});

layer("GitHubCliLive", (it) => {
  it.effect("paginates GraphQL review threads with provider cursors", () =>
    Effect.gen(function* () {
      const page = (id: string, hasNextPage: boolean, endCursor: string | null) =>
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage, endCursor },
                  nodes: [
                    {
                      id,
                      path: "src/app.ts",
                      line: 4,
                      diffSide: "RIGHT",
                      comments: {
                        nodes: [
                          {
                            id: `${id}-comment`,
                            body: id,
                            createdAt: "2026-09-01T10:00:00Z",
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        });
      cliOnly([
        ok("tabs/app\n"),
        ok(page("thread-1", true, "cursor-1")),
        ok(page("thread-2", false, null)),
      ]);

      const gh = yield* GitHubCli;
      const threads = yield* gh.getPullRequestReviewThreads({ cwd: "/repo", reference: "42" });
      expect(threads.map((thread) => thread.id)).toEqual(["thread-1", "thread-2"]);
      expect(
        mockedRunProcess.mock.calls.some(
          ([command, args]) => command === "gh" && args.includes("cursor=cursor-1"),
        ),
      ).toBe(true);
    }),
  );

  it.effect("normalizes pull request file patches and binary omissions", () =>
    Effect.gen(function* () {
      cliOnly([ok(JSON.stringify([
          [
            {
              filename: "src/new.ts",
              previous_filename: "src/old.ts",
              status: "renamed",
              additions: 4,
              deletions: 2,
              patch: "@@ -1 +1 @@\n-old\n+new",
            },
          ],
          [
            {
              filename: "public/logo.png",
              status: "modified",
              additions: 0,
              deletions: 0,
            },
          ],
        ]))]);

      const gh = yield* GitHubCli;
      const files = yield* gh.getPullRequestFiles({ cwd: "/repo", reference: "42" });

      assert.deepStrictEqual(files, [
        {
          path: "src/new.ts",
          previousPath: "src/old.ts",
          status: "renamed",
          additions: 4,
          deletions: 2,
          patch: "@@ -1 +1 @@\n-old\n+new",
          patchTruncated: false,
        },
        {
          path: "public/logo.png",
          status: "modified",
          additions: 0,
          deletions: 0,
          patch: null,
          patchTruncated: false,
        },
      ]);
      expect(mockedRunProcess).toHaveBeenCalledWith(
        "gh",
        ["api", "--paginate", "--slurp", "repos/{owner}/{repo}/pulls/42/files"],
        expect.objectContaining({ cwd: "/repo" }),
      );
    }),
  );

  it.effect("parses pull request view output", () =>
    Effect.gen(function* () {
      cliOnly([
        ok(
          JSON.stringify({
          number: 42,
          title: "Add PR thread creation",
          url: "https://github.com/pingdotgg/codething-mvp/pull/42",
          baseRefName: "main",
          headRefName: "feature/pr-threads",
          state: "OPEN",
          mergedAt: null,
          isCrossRepository: true,
          headRepository: {
            nameWithOwner: "octocat/codething-mvp",
          },
          headRepositoryOwner: {
            login: "octocat",
          },
          isDraft: false,
          author: { login: "octocat", avatarUrl: "https://avatars.example/octocat" },
          labels: [{ name: "enhancement", color: "84b6eb", description: null }],
          reviewDecision: "APPROVED",
          mergeable: "MERGEABLE",
          statusCheckRollup: [{ name: "CI", status: "COMPLETED", conclusion: "SUCCESS" }],
          additions: 120,
          deletions: 18,
          changedFiles: 7,
          createdAt: "2026-09-01T10:00:00Z",
          updatedAt: "2026-09-04T10:00:00Z",
          body: "Implements the PR workspace.",
          reviewRequests: [{ login: "reviewer" }],
          comments: [
            {
              id: "comment-1",
              author: { login: "reviewer" },
              body: "Looks good.",
              createdAt: "2026-09-04T09:00:00Z",
            },
          ],
          reviews: [
            {
              id: "review-1",
              author: { login: "reviewer" },
              body: "Approved.",
              state: "APPROVED",
              submittedAt: "2026-09-04T09:30:00Z",
            },
          ],
          commits: [
            {
              oid: "abcdef1234567890",
              messageHeadline: "Build PR workspace",
              authoredDate: "2026-09-03T10:00:00Z",
              authors: [{ login: "octocat" }],
            },
          ],
        }),
        ),
      ]);

      const result = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.getPullRequest({
          cwd: "/repo",
          reference: "#42",
        });
      });

      assert.deepStrictEqual(result, {
        number: 42,
        title: "Add PR thread creation",
        url: "https://github.com/pingdotgg/codething-mvp/pull/42",
        baseRefName: "main",
        headRefName: "feature/pr-threads",
        state: "open",
        isCrossRepository: true,
        headRepositoryNameWithOwner: "octocat/codething-mvp",
        headRepositoryOwnerLogin: "octocat",
        isDraft: false,
        author: { login: "octocat", avatarUrl: "https://avatars.example/octocat" },
        labels: [{ name: "enhancement", color: "84b6eb", description: null }],
        reviewDecision: "approved",
        mergeability: "mergeable",
        checksState: "passing",
        checks: [{ name: "CI", status: "completed", conclusion: "SUCCESS" }],
        additions: 120,
        deletions: 18,
        changedFiles: 7,
        createdAt: "2026-09-01T10:00:00Z",
        updatedAt: "2026-09-04T10:00:00Z",
        body: "Implements the PR workspace.",
        reviewers: [{ login: "reviewer" }],
        comments: [
          {
            id: "comment-1",
            author: { login: "reviewer" },
            body: "Looks good.",
            createdAt: "2026-09-04T09:00:00Z",
          },
        ],
        reviews: [
          {
            id: "review-1",
            author: { login: "reviewer" },
            body: "Approved.",
            state: "APPROVED",
            submittedAt: "2026-09-04T09:30:00Z",
          },
        ],
        commits: [
          {
            sha: "abcdef1234567890",
            subject: "Build PR workspace",
            authoredAt: "2026-09-03T10:00:00Z",
            authors: [{ login: "octocat" }],
          },
        ],
      });
      expect(mockedRunProcess).toHaveBeenCalledWith(
        "gh",
        [
          "pr",
          "view",
          "#42",
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner,isDraft,author,labels,reviewDecision,mergeable,statusCheckRollup,additions,deletions,changedFiles,createdAt,updatedAt,body,reviewRequests,comments,reviews,commits",
        ],
        expect.objectContaining({ cwd: "/repo" }),
      );
    }),
  );

  it.effect("reads repository clone URLs", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: JSON.stringify({
          nameWithOwner: "octocat/codething-mvp",
          url: "https://github.com/octocat/codething-mvp",
          sshUrl: "git@github.com:octocat/codething-mvp.git",
        }),
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const result = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.getRepositoryCloneUrls({
          cwd: "/repo",
          repository: "octocat/codething-mvp",
        });
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/codething-mvp",
        url: "https://github.com/octocat/codething-mvp",
        sshUrl: "git@github.com:octocat/codething-mvp.git",
      });
    }),
  );

  it.effect("surfaces a friendly error when the pull request is not found", () =>
    Effect.gen(function* () {
      cliOnly([]);
      mockedRunProcess.mockImplementation(async (command, args) => {
        if (command === "git" || args[0] === "auth") throw new Error("direct path unavailable");
        throw new Error(
          "GraphQL: Could not resolve to a PullRequest with the number of 4888. (repository.pullRequest)",
        );
      });

      const error = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.getPullRequest({
          cwd: "/repo",
          reference: "4888",
        });
      }).pipe(Effect.flip);

      assert.equal(error.message.includes("Pull request not found"), true);
    }),
  );

  it.effect("passes pull request mutations as process arguments without shell interpolation", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValue({
        stdout: "",
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const gh = yield* GitHubCli;
      yield* gh.mutatePullRequest({
        cwd: "/repo",
        reference: "42",
        action: "request_changes",
        body: "Please fix `$(unsafe)`; this must stay literal.",
      });

      expect(mockedRunProcess).toHaveBeenCalledWith(
        "gh",
        [
          "pr",
          "review",
          "42",
          "--request-changes",
          "--body",
          "Please fix `$(unsafe)`; this must stay literal.",
        ],
        expect.objectContaining({ cwd: "/repo" }),
      );

      yield* gh.mutatePullRequest({
        cwd: "/repo",
        reference: "42",
        action: "add_label",
        value: "release;$(literal)",
      });
      expect(mockedRunProcess).toHaveBeenCalledWith(
        "gh",
        ["pr", "edit", "42", "--add-label", "release;$(literal)"],
        expect.objectContaining({ cwd: "/repo" }),
      );
    }),
  );

  it.effect("creates provider-backed inline comments with the pull request head SHA", () =>
    Effect.gen(function* () {
      mockedRunProcess
        .mockResolvedValueOnce({
          stdout: "abc123\n",
          stderr: "",
          code: 0,
          signal: null,
          timedOut: false,
        })
        .mockResolvedValueOnce({
          stdout: "{}",
          stderr: "",
          code: 0,
          signal: null,
          timedOut: false,
        });

      const gh = yield* GitHubCli;
      yield* gh.mutatePullRequest({
        cwd: "/repo",
        reference: "42",
        action: "inline_comment",
        path: "src/app.ts",
        line: 9,
        side: "right",
        body: "Handle `$(literal)` here.",
      });

      expect(mockedRunProcess).toHaveBeenNthCalledWith(
        2,
        "gh",
        [
          "api",
          "--method",
          "POST",
          "repos/{owner}/{repo}/pulls/42/comments",
          "--raw-field",
          "body=Handle `$(literal)` here.",
          "--raw-field",
          "commit_id=abc123",
          "--raw-field",
          "path=src/app.ts",
          "--field",
          "line=9",
          "--raw-field",
          "side=RIGHT",
        ],
        expect.objectContaining({ cwd: "/repo" }),
      );
    }),
  );

  it.effect("uses GraphQL node identities for thread resolution and reactions", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValue({
        stdout: "{}",
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });
      const gh = yield* GitHubCli;
      yield* gh.mutatePullRequest({
        cwd: "/repo",
        reference: "42",
        action: "resolve_thread",
        threadId: "PRRT_unsafe;$(literal)",
      });
      yield* gh.mutatePullRequest({
        cwd: "/repo",
        reference: "42",
        action: "add_reaction",
        subjectId: "PRRC_comment",
        reaction: "ROCKET",
      });

      expect(mockedRunProcess.mock.calls[0]?.[1]).toContain("threadId=PRRT_unsafe;$(literal)");
      expect(mockedRunProcess.mock.calls[1]?.[1]).toEqual(
        expect.arrayContaining(["subjectId=PRRC_comment", "content=ROCKET"]),
      );
    }),
  );
});

const node = (overrides: Record<string, unknown> = {}) => ({
  number: 7,
  title: "Speed up list",
  url: "https://github.com/tabs/app/pull/7",
  baseRefName: "main",
  headRefName: "feat",
  state: "OPEN",
  mergedAt: null,
  isDraft: false,
  isCrossRepository: false,
  author: { login: "octo" },
  headRepository: { nameWithOwner: "tabs/app" },
  headRepositoryOwner: { login: "tabs" },
  labels: { nodes: [{ name: "perf", color: "ffffff", description: null }] },
  reviewDecision: "APPROVED",
  mergeable: "MERGEABLE",
  additions: 3,
  deletions: 1,
  changedFiles: 2,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-02T00:00:00Z",
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] },
  ...overrides,
});
const ok = (stdout: string) => ({ stdout, stderr: "", code: 0, signal: null, timedOut: false });

const graphqlBody = JSON.stringify({
  data: { repository: { pullRequests: { nodes: [node(), null] } } },
});

layer("GitHubCliLive list", (it) => {
  it.effect("lists over one direct HTTPS read, without starting gh for the list itself", () =>
    Effect.gen(function* () {
      clearGitHubDirectCaches();
      mockedRunProcess.mockImplementation(async (_command, args) =>
        ok(args[0] === "remote" ? "https://github.com/tabs/app.git\n" : "token-abc\n"),
      );
      const fetchMock = vi.fn(async () => new Response(graphqlBody, { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const gh = yield* GitHubCli;
      const list = yield* gh.listOpenPullRequests({ cwd: "/repo", state: "open", limit: 50 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.github.com/graphql");
      expect(JSON.parse(String(init.body)).variables).toMatchObject({
        owner: "tabs",
        name: "app",
        limit: 50,
      });
      expect(
        mockedRunProcess.mock.calls.some(([command, args]) => command === "gh" && args[0] === "pr"),
      ).toBe(false);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        number: 7,
        state: "open",
        checksState: "failing",
        reviewDecision: "approved",
        mergeability: "mergeable",
        labels: [{ name: "perf" }],
      });

      // A second read reuses the held token: no further `gh auth token`.
      yield* gh.listOpenPullRequests({ cwd: "/repo", state: "open", limit: 50 });
      expect(
        mockedRunProcess.mock.calls.filter(([, args]) => args[0] === "auth"),
      ).toHaveLength(1);
    }),
  );

  it.effect("falls back to gh's GraphQL, then gh pr list, when the direct read fails", () =>
    Effect.gen(function* () {
      clearGitHubDirectCaches();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("nope", { status: 500 })),
      );
      mockedRunProcess.mockImplementation(async (_command, args) => {
        if (args[0] === "remote") return ok("git@github.com:tabs/app.git\n");
        if (args[0] === "auth") return ok("token-abc\n");
        if (args[0] === "api") return ok(graphqlBody);
        throw new Error("unexpected");
      });
      const gh = yield* GitHubCli;
      const list = yield* gh.listOpenPullRequests({ cwd: "/repo", state: "all", limit: 50 });
      expect(list.map((pr) => pr.number)).toEqual([7]);

      mockedRunProcess.mockImplementation(async (_command, args) => {
        if (args[0] === "remote") return ok("git@github.com:tabs/app.git\n");
        if (args[0] === "auth") return ok("token-abc\n");
        if (args[0] === "api") throw new Error("boom");
        return ok(
          JSON.stringify([
            {
              number: 9,
              title: "From CLI",
              url: "https://github.com/tabs/app/pull/9",
              baseRefName: "main",
              headRefName: "x",
              state: "OPEN",
            },
          ]),
        );
      });
      const second = yield* gh.listOpenPullRequests({ cwd: "/repo", state: "all", limit: 50 });
      expect(second.map((pr) => pr.number)).toEqual([9]);
    }),
  );

  it.effect("keeps gh pr list for a head selector", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockReset();
      mockedRunProcess.mockResolvedValueOnce(ok("[]"));
      const gh = yield* GitHubCli;
      yield* gh.listOpenPullRequests({ cwd: "/repo", headSelector: "feat", limit: 5 });
      expect(mockedRunProcess).toHaveBeenCalledTimes(1);
      expect(mockedRunProcess.mock.calls[0]?.[1]?.slice(0, 2)).toEqual(["pr", "list"]);
    }),
  );
});
