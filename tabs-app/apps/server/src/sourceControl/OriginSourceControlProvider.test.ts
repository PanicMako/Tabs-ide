import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { detectSourceControlProviderFromRemoteUrl } from "@tabs/shared/sourceControl";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as OriginCli from "./OriginCli.ts";
import * as OriginSourceControlProvider from "./OriginSourceControlProvider.ts";
import {
  originRepositoryFromRemote,
  originState,
  parseOriginPullUrl,
  pullReference,
} from "./originPullRequests.ts";
import * as SourceControlProvider from "./SourceControlProvider.ts";

const pull = (extra: Record<string, unknown> = {}) => ({
  number: 12,
  state: "open",
  draft: false,
  title: "Add feature",
  head: { ref: "feature", sha: "abc" },
  base: { ref: "main" },
  updatedAt: "2026-01-01T00:00:00.000Z",
  webUrl: "https://cursor.com/codebase/acme/app/pull/12",
  ...extra,
});

const layerFor = (
  respond: (input: { path: string; method?: string; body?: unknown }) => unknown,
  calls: Array<{ path: string; method?: string; body?: unknown }> = [],
) =>
  Layer.mergeAll(
    Layer.succeed(
      OriginCli.OriginCli,
      OriginCli.OriginCli.of({
        execute: () => Effect.succeed(""),
        api: ((
          input: { path: string; method?: "GET" | "POST" | "PATCH"; body?: unknown },
          schema: never,
        ) => {
          calls.push(input);
          return Effect.succeed(respond(input) as never);
        }) as never,
        viewer: () => Effect.succeed("maria@example.com"),
        personalNamespace: () => Effect.succeed("maria"),
        resolveRepository: () => Effect.succeed("acme/app"),
      }),
    ),
    Layer.mock(VcsProcess.VcsProcess)({}),
    FileSystem.layerNoop({ readFileString: () => Effect.succeed("Body") }),
  );

const provide = <A, E>(
  effect: Effect.Effect<A, E, SourceControlProvider.SourceControlProvider>,
  layer: ReturnType<typeof layerFor>,
) =>
  Effect.gen(function* () {
    const provider = yield* OriginSourceControlProvider.make;
    return yield* effect.pipe(
      Effect.provideService(SourceControlProvider.SourceControlProvider, provider),
    );
  }).pipe(Effect.provide(layer));

describe("OriginSourceControlProvider", () => {
  it.effect("reads and lists pull requests", () => {
    const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
    return provide(
      Effect.gen(function* () {
        const provider = yield* SourceControlProvider.SourceControlProvider;
        const one = yield* provider.getChangeRequest({ cwd: "/r", reference: "#12" });
        assert.strictEqual(one.provider, "cursor-origin");
        assert.strictEqual(one.number, 12);
        assert.strictEqual(calls[0]?.path, "/v1/origin/repos/acme/app/pulls/12");
        const many = yield* provider.listChangeRequests({
          cwd: "/r",
          headSelector: "feature",
          state: "open",
        });
        assert.strictEqual(many.length, 1);
        assert.include(calls[1]?.path ?? "", "head=feature");
      }),
      layerFor((input) => (input.path.includes("?") ? { pullRequests: [pull()] } : pull()), calls),
    );
  });

  it.effect("creates pull requests as ready and makes new repositories private", () => {
    const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
    return provide(
      Effect.gen(function* () {
        const provider = yield* SourceControlProvider.SourceControlProvider;
        yield* provider.createChangeRequest({
          cwd: "/r",
          baseRefName: "main",
          headSelector: "feature",
          title: "T",
          bodyFile: "/b.md",
        });
        assert.deepStrictEqual(calls[0]?.body, {
          title: "T",
          body: "Body",
          head: "feature",
          base: "main",
          draft: false,
        });
        const urls = yield* provider.createRepository({
          cwd: "/r",
          repository: "app2",
          visibility: "private",
        });
        assert.strictEqual(urls.nameWithOwner, "maria/app2");
        assert.strictEqual(calls.at(-1)?.method, "PATCH");
        const error = yield* provider
          .createRepository({ cwd: "/r", repository: "x", visibility: "public" })
          .pipe(Effect.flip);
        assert.include(error.detail, "private");
      }),
      layerFor(
        (input) =>
          input.method === "PATCH" || input.method === "POST"
            ? { name: "app2", owner: { slug: "maria" } }
            : {},
        calls,
      ),
    );
  });
});

describe("Cursor Origin helpers", () => {
  it("parses cursor.com pull URLs and references", () => {
    const link = parseOriginPullUrl(new URL("https://cursor.com/codebase/Acme/App/pull/5"));
    assert.deepStrictEqual(link, {
      host: "origin.cursor.com",
      repository: "acme/app",
      number: 5,
    });
    assert.isNull(parseOriginPullUrl(new URL("https://github.com/a/b/pull/5")));
    assert.deepStrictEqual(pullReference("https://github.com/a/b/pull/5"), {
      repository: null,
      number: null,
    });
    assert.strictEqual(pullReference("#8").number, 8);
  });

  it("reads Origin remotes and states", () => {
    assert.strictEqual(
      originRepositoryFromRemote("https://origin.cursor.com/acme/app.git"),
      "acme/app",
    );
    assert.isNull(originRepositoryFromRemote("https://github.com/acme/app.git"));
    assert.strictEqual(
      detectSourceControlProviderFromRemoteUrl("https://origin.cursor.com/acme/app.git")?.kind,
      "cursor-origin",
    );
    assert.strictEqual(originState({ state: "closed", mergedAt: "2026-01-01" } as never), "merged");
  });

  it("reads auth status and classifies failures", () => {
    const status = OriginCli.parseOriginAuthStatus(
      JSON.stringify({ authenticated: true, account: { email: "m@example.com" } }),
    );
    assert.strictEqual(OriginCli.originAccount(status), "m@example.com");
    assert.isNull(OriginCli.originAccount({ authenticated: true, tokenValid: false }));
    const auth = OriginSourceControlProvider.discovery.parseAuth({
      stdout: JSON.stringify({ authenticated: false }),
      stderr: "",
      exitCode: 1,
    } as never);
    assert.strictEqual(auth.status, "unauthenticated");
    assert.isTrue(Option.isNone(auth.account));
    assert.strictEqual(
      OriginCli.classifyOriginResponse({ operation: "x", cwd: "/", status: 429, body: "" }).reason,
      "rate-limited",
    );
    assert.strictEqual(
      OriginCli.classifyOriginFailure({
        operation: "x",
        cwd: "/",
        stdout: "",
        stderr: "Error: not logged in",
      }).reason,
      "unauthenticated",
    );
  });
});
