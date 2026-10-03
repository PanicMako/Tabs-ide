import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../processRunner", () => ({ runProcess: vi.fn() }));

import { runProcess } from "../../processRunner";
import {
  decodeBitbucketPullRequests,
  decodeBitbucketThreads,
  parseBitbucketDiff,
  makeBitbucketPullRequestApi,
} from "./BitbucketPullRequestApi";

const mockedRunProcess = vi.mocked(runProcess);

afterEach(() => {
  mockedRunProcess.mockReset();
  vi.unstubAllGlobals();
  delete process.env.T3CODE_BITBUCKET_ACCESS_TOKEN;
});

describe("BitbucketPullRequestApi normalization", () => {
  it("normalizes pull requests without inventing provider metadata", () => {
    expect(
      decodeBitbucketPullRequests({
        values: [
          {
            id: 12,
            title: "Ship Bitbucket support",
            description: "Real provider data.",
            state: "OPEN",
            author: { nickname: "author" },
            reviewers: [{ nickname: "reviewer" }],
            source: { branch: { name: "feature/bitbucket" } },
            destination: { branch: { name: "main" } },
            links: {
              html: { href: "https://bitbucket.org/tabs/app/pull-requests/12" },
            },
          },
        ],
      }),
    ).toMatchObject([
      {
        provider: "bitbucket",
        number: 12,
        state: "open",
        headBranch: "feature/bitbucket",
        baseBranch: "main",
        author: { login: "author" },
        reviewers: [{ login: "reviewer" }],
      },
    ]);
  });

  it("splits provider diff text into bounded file patches", () => {
    expect(
      parseBitbucketDiff(
        "diff --git a/src/old.ts b/src/new.ts\nsimilarity index 90%\n--- a/src/old.ts\n+++ b/src/new.ts\n@@ -1 +1 @@\n-old\n+new",
      ),
    ).toMatchObject([
      {
        path: "src/new.ts",
        previousPath: "src/old.ts",
        status: "renamed",
        additions: 1,
        deletions: 1,
      },
    ]);
  });

  it("groups inline replies into resolvable provider threads", () => {
    expect(
      decodeBitbucketThreads({
        values: [
          {
            id: 5,
            content: { raw: "Please fix this." },
            created_on: "2026-09-01T10:00:00Z",
            user: { nickname: "reviewer" },
            inline: { path: "src/app.ts", to: 8 },
            resolution: { user: { nickname: "author" } },
          },
          {
            id: 6,
            parent: { id: 5 },
            content: { raw: "Fixed." },
            created_on: "2026-09-01T11:00:00Z",
            user: { nickname: "author" },
            inline: { path: "src/app.ts", to: 8 },
          },
        ],
      }),
    ).toMatchObject([
      {
        id: "5",
        path: "src/app.ts",
        line: 8,
        side: "right",
        resolved: true,
        comments: [{ id: "5" }, { id: "6" }],
      },
    ]);
  });
});

describe("BitbucketPullRequestApi requests", () => {
  it("follows provider pagination and sends structured inline comments", async () => {
    process.env.T3CODE_BITBUCKET_ACCESS_TOKEN = "token";
    mockedRunProcess.mockResolvedValue({
      stdout: "git@bitbucket.org:tabs/app.git\n",
      stderr: "",
      code: 0,
      signal: null,
      timedOut: false,
    });
    const pullRequest = (id: number) => ({
      id,
      title: `PR ${id}`,
      state: "OPEN",
      source: { branch: { name: `feature-${id}` } },
      destination: { branch: { name: "main" } },
      links: {
        html: { href: `https://bitbucket.org/tabs/app/pull-requests/${id}` },
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            values: [pullRequest(1)],
            next: "https://api.bitbucket.org/2.0/repositories/tabs/app/pullrequests?page=2",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ values: [pullRequest(2)] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const api = await Effect.runPromise(makeBitbucketPullRequestApi);
    const listed = await Effect.runPromise(
      api.listPullRequests({ cwd: "/repo", state: "open", limit: 2 }),
    );
    expect(listed.map((entry) => entry.number)).toEqual([1, 2]);

    await Effect.runPromise(
      api.mutatePullRequest({
        cwd: "/repo",
        reference: "12",
        action: "inline_comment",
        path: "src/app.ts",
        line: 9,
        side: "right",
        body: "Handle `$(literal)`.",
      }),
    );
    const mutation = fetchMock.mock.calls[2];
    expect(mutation?.[0]).toBe(
      "https://api.bitbucket.org/2.0/repositories/tabs/app/pullrequests/12/comments",
    );
    expect(JSON.parse(String(mutation?.[1]?.body))).toEqual({
      content: { raw: "Handle `$(literal)`." },
      inline: { path: "src/app.ts", to: 9 },
    });
  });

  it("partially updates pull request text without overwriting other fields", async () => {
    process.env.T3CODE_BITBUCKET_ACCESS_TOKEN = "token";
    mockedRunProcess.mockResolvedValue({
      stdout: "git@bitbucket.org:tabs/app.git\n",
      stderr: "",
      code: 0,
      signal: null,
      timedOut: false,
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const api = await Effect.runPromise(makeBitbucketPullRequestApi);
    await Effect.runPromise(
      api.mutatePullRequest({
        cwd: "/repo",
        reference: "12",
        action: "edit_pull_request",
        title: "Updated title",
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.bitbucket.org/2.0/repositories/tabs/app/pullrequests/12",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ title: "Updated title" }),
      }),
    );
  });

  it("escapes provider search filters and replaces the complete reviewer set", async () => {
    process.env.T3CODE_BITBUCKET_ACCESS_TOKEN = "token";
    mockedRunProcess.mockResolvedValue({
      stdout: "git@bitbucket.org:tabs/app.git\n",
      stderr: "",
      code: 0,
      signal: null,
      timedOut: false,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ values: [] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ reviewers: [{ uuid: "{existing}", nickname: "existing" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            values: [{ user: { uuid: "{new}", nickname: 'new"reviewer' } }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const api = await Effect.runPromise(makeBitbucketPullRequestApi);
    await Effect.runPromise(
      api.listPullRequests({ cwd: "/repo", state: "open", limit: 20, query: 'fix "login"' }),
    );
    const listUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(listUrl.searchParams.get("q")).toBe(
      '(title ~ "fix \\"login\\"" OR description ~ "fix \\"login\\"")',
    );

    await Effect.runPromise(
      api.mutatePullRequest({
        cwd: "/repo",
        reference: "12",
        action: "add_reviewer",
        value: 'new"reviewer',
      }),
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/workspaces/tabs/members?");
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({
      reviewers: [{ uuid: "{existing}" }, { uuid: "{new}" }],
    });
  });
});
