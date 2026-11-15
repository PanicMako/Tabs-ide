import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { detectSourceControlProviderFromRemoteUrl } from "@tabs/shared/sourceControl";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitCafeApi from "./GitCafeApi.ts";
import * as GitCafeCredentials from "./GitCafeCredentials.ts";
import * as GitCafeSourceControlProvider from "./GitCafeSourceControlProvider.ts";
import * as SourceControlProvider from "./SourceControlProvider.ts";

const pull = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  title: `Pull ${number}`,
  state: "open",
  draft: false,
  sourceBranch: "feature",
  targetBranch: "main",
  headOid: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  sourceRepo: null,
  closedAt: null,
  mergedAt: null,
  ...extra,
});

const makeLayer = (
  respond: (input: GitCafeApi.GitCafeApiRequest) => unknown,
  calls: Array<GitCafeApi.GitCafeApiRequest> = [],
) =>
  Layer.mergeAll(
    Layer.succeed(
      GitCafeApi.GitCafeApi,
      GitCafeApi.GitCafeApi.of({
        request: (input) => {
          calls.push(input);
          return Effect.succeed(JSON.stringify(respond(input)));
        },
      }),
    ),
    Layer.mock(VcsProcess.VcsProcess)({
      run: () =>
        Effect.succeed({
          exitCode: 0,
          stdout: "git@git.cafe:acme/app.git\n",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        } as never),
    }),
    FileSystem.layerNoop({ readFileString: () => Effect.succeed("Body text") }),
  );

const provide = <A, E>(
  effect: Effect.Effect<A, E, SourceControlProvider.SourceControlProvider>,
  layer: ReturnType<typeof makeLayer>,
) =>
  Effect.gen(function* () {
    const provider = yield* GitCafeSourceControlProvider.make;
    return yield* effect.pipe(
      Effect.provideService(SourceControlProvider.SourceControlProvider, provider),
    );
  }).pipe(Effect.provide(layer));

describe("GitCafeSourceControlProvider", () => {
  it.effect("reads a pull request from its URL and maps fork identity", () => {
    const calls: Array<GitCafeApi.GitCafeApiRequest> = [];
    return provide(
      Effect.gen(function* () {
        const provider = yield* SourceControlProvider.SourceControlProvider;
        const result = yield* provider.getChangeRequest({
          cwd: "/repo",
          reference: "https://git.cafe/acme/app/pull/7",
        });
        assert.strictEqual(result.provider, "gitcafe");
        assert.strictEqual(result.url, "https://git.cafe/acme/app/pulls/7");
        assert.strictEqual(result.isCrossRepository, true);
        assert.strictEqual(result.headRepositoryNameWithOwner, "fork/app");
        assert.strictEqual(calls[0]?.path, "/repos/acme/app/pulls/7");
      }),
      makeLayer(() => pull(7, { sourceRepo: { owner: "fork", name: "app" } }), calls),
    );
  });

  it.effect("lists pull requests for a branch from the remote's repository", () => {
    const calls: Array<GitCafeApi.GitCafeApiRequest> = [];
    return provide(
      Effect.gen(function* () {
        const provider = yield* SourceControlProvider.SourceControlProvider;
        const result = yield* provider.listChangeRequests({
          cwd: "/repo",
          headSelector: "feature",
          state: "open",
        });
        assert.deepStrictEqual(
          result.map((entry) => entry.number),
          [3],
        );
        assert.include(calls[0]?.path ?? "", "/repos/acme/app/pulls?");
        assert.include(calls[0]?.path ?? "", "state=open");
      }),
      makeLayer(
        (input) =>
          input.path.includes("/pulls?")
            ? { items: [pull(3), pull(4, { sourceBranch: "other" })], next: null }
            : pull(3),
        calls,
      ),
    );
  });

  it.effect("creates a pull request by the head repository's id", () => {
    const calls: Array<GitCafeApi.GitCafeApiRequest> = [];
    return provide(
      Effect.gen(function* () {
        const provider = yield* SourceControlProvider.SourceControlProvider;
        yield* provider.createChangeRequest({
          cwd: "/repo",
          baseRefName: "main",
          headSelector: "feature",
          title: "Add feature",
          bodyFile: "/tmp/body.md",
        });
        const post = calls.find((call) => call.method === "POST");
        assert.deepStrictEqual(post?.body, {
          repo: "repo-1",
          source: "feature",
          target: "main",
          title: "Add feature",
          description: "Body text",
        });
      }),
      makeLayer((input) => (input.method === "POST" ? { number: 9 } : { id: "repo-1" }), calls),
    );
  });

  it.effect("returns the default branch and clone URLs", () =>
    provide(
      Effect.gen(function* () {
        const provider = yield* SourceControlProvider.SourceControlProvider;
        assert.strictEqual(yield* provider.getDefaultBranch({ cwd: "/repo" }), "main");
        const urls = yield* provider.getRepositoryCloneUrls({
          cwd: "/repo",
          repository: "acme/app",
        });
        assert.strictEqual(urls.url, "https://git.cafe/acme/app");
        assert.strictEqual(urls.sshUrl, "ssh@git.cafe:acme/app.git");
      }),
      makeLayer(() => ({ name: "app", defaultBranch: "main" })),
    ),
  );

  it.effect("rejects a repository outside GitCafe", () =>
    provide(
      Effect.gen(function* () {
        const provider = yield* SourceControlProvider.SourceControlProvider;
        const error = yield* provider
          .getChangeRequest({ cwd: "/repo", reference: "not-a-pull" })
          .pipe(Effect.flip);
        assert.strictEqual(error.provider, "gitcafe");
      }),
      makeLayer(() => pull(1)),
    ),
  );
});

describe("GitCafe discovery and credentials", () => {
  it("reads signed-in and failed auth output", () => {
    const signedIn = GitCafeSourceControlProvider.parseAuth({
      stdout: JSON.stringify({ schemaVersion: 1, data: { host: "git.cafe", username: "maria" } }),
      stderr: "",
      exitCode: 0,
    } as never);
    assert.strictEqual(signedIn.status, "authenticated");
    assert.deepStrictEqual(signedIn.account, Option.some("maria"));
    const expired = GitCafeSourceControlProvider.parseAuth({
      stdout: "",
      stderr: JSON.stringify({
        schemaVersion: 1,
        error: { code: "AUTHENTICATION_REQUIRED", message: "Sign in", status: 401 },
      }),
      exitCode: 1,
    } as never);
    assert.strictEqual(expired.status, "unauthenticated");
    const unreadable = GitCafeSourceControlProvider.parseAuth({
      stdout: "nope",
      stderr: "",
      exitCode: 1,
    } as never);
    assert.strictEqual(unreadable.status, "unknown");
  });

  it("applies CAFE_TOKEN only to CAFE_HOST", () => {
    assert.strictEqual(
      GitCafeCredentials.environmentToken("git.cafe", { CAFE_TOKEN: " abc " }),
      "abc",
    );
    assert.isNull(GitCafeCredentials.environmentToken("staging.git.cafe", { CAFE_TOKEN: "abc" }));
    assert.strictEqual(
      GitCafeCredentials.environmentToken("staging.git.cafe", {
        CAFE_TOKEN: "abc",
        CAFE_HOST: "https://staging.git.cafe",
      }),
      "abc",
    );
  });

  it("follows only same-origin API redirects", () => {
    const origin = "https://git.cafe";
    const from = "https://git.cafe/api/repos/a/b/pulls/1";
    assert.strictEqual(
      GitCafeApi.redirectTarget("GET", origin, from, {
        status: 308,
        location: "/api/repos/a/b/pulls/2",
      }),
      "https://git.cafe/api/repos/a/b/pulls/2",
    );
    assert.isNull(
      GitCafeApi.redirectTarget("GET", origin, from, {
        status: 302,
        location: "https://evil.example/api/x",
      }),
    );
    assert.isNull(
      GitCafeApi.redirectTarget("POST", origin, from, {
        status: 302,
        location: "/api/repos/a/b/pulls/2",
      }),
    );
  });

  it("detects git.cafe remotes", () => {
    assert.strictEqual(
      detectSourceControlProviderFromRemoteUrl("git@git.cafe:acme/app.git")?.kind,
      "gitcafe",
    );
    assert.strictEqual(
      GitCafeSourceControlProvider.parseGitCafePullUrl("https://git.cafe/acme/app/pull/12")?.number,
      12,
    );
    assert.isNull(
      GitCafeSourceControlProvider.parseGitCafePullUrl("https://github.com/a/b/pull/1"),
    );
  });
});
