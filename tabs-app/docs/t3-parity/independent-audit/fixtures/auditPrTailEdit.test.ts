import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Reactor from "./PullRequestWatchReactor.ts";
import * as Engine from "./Orchestrator.ts";
import * as Projections from "./ProjectionStore.ts";
import * as PR from "../pullRequest/PullRequestService.ts";

it.effect("refreshes an edited paginated tail even when comment count stays unchanged", () =>
  Effect.gen(function* () {
    const start = "2026-10-01T00:00:00Z";
    let watch: any = {
      startedAt: start,
      headSha: "abc",
      failedChecks: [],
      passed: false,
      passedChecks: [],
      remarksThrough: start,
      remarkIds: [],
      conflicting: false,
      wakes: 0,
    };
    const control = process.env.TABS_AUDIT_TAIL_CONTROL === "1";
    let edited = false;
    let pages = 0;
    let activityReads = 0;
    const wakes: string[] = [];
    const comment = (id: string, time: string, body: string) => ({
      id,
      kind: "review-comment",
      author: { login: "reviewer", name: null, avatarUrl: null },
      body,
      createdAt: time,
      url: "https://example.test/pr/1",
      path: "file.ts",
      reviewState: null,
    });
    const link = () => ({
      host: "github.com",
      repository: "o/r",
      number: 1,
      url: "https://github.com/o/r/pull/1",
      source: "manual",
      linkedAt: start,
      snapshot: null,
      stack: null,
      watch,
    });
    const layers = Layer.mergeAll(
      NodeCrypto.layer,
      Layer.mock(Engine.OrchestratorV2)({
        dispatch: (command: any) =>
          Effect.sync(() => {
            watch = command.watch;
            if (command.wake) wakes.push(command.wake.text);
            return {} as any;
          }),
      }),
      Layer.mock(Projections.ProjectionStoreV2)({
        getThreadsWithPullRequests: () =>
          Effect.sync(
            () =>
              [
                {
                  id: "thread1",
                  projectId: "project1",
                  settledOverride: null,
                  settledAt: null,
                  lineage: { relationshipToParent: null },
                  pullRequests: [link()],
                },
              ] as any,
          ),
      }),
      Layer.mock(PR.PullRequestService)({
        watchFingerprint: () => Effect.succeed(null),
        detail: () =>
          Effect.succeed({
            state: "open",
            headSha: "abc",
            checks: [],
            mergeability: "mergeable",
            viewer: "agent",
            author: { login: "agent" },
            baseBranch: "main",
          } as any),
        activity: () =>
          Effect.sync(() => {
            activityReads++;
            const first = comment("first", "2026-10-01T00:01:00Z", "first");
            return {
              comments: [first],
              commentsTruncated: true,
              reviewThreadsTruncated: false,
              reviewThreads: [
                {
                  id: "review-thread",
                  nextCommentsCursor: "next",
                  commentCount: edited && control ? 3 : 2,
                  comments: [first],
                  path: "file.ts",
                },
              ],
            } as any;
          }),
        threadComments: () =>
          Effect.sync(() => {
            pages++;
            return {
              comments: [
                {
                  ...comment(
                    "tail",
                    "2026-10-01T00:02:00Z",
                    edited ? "edited tail" : "original tail",
                  ),
                  ...(edited ? { editedAt: "2026-10-01T00:03:00Z" } : {}),
                },
                ...(edited && control
                  ? [comment("new", "2026-10-01T00:03:00Z", "new comment")]
                  : []),
              ],
              nextCursor: null,
            } as any;
          }),
      }),
    );
    yield* Effect.gen(function* () {
      const reactor = yield* Reactor.PullRequestWatchReactor;
      yield* reactor.sweep;
      edited = true;
      yield* TestClock.adjust("11 minutes");
      yield* reactor.sweep;
    }).pipe(Effect.provide(Reactor.layer.pipe(Layer.provide(layers))));
    console.log(
      JSON.stringify({
        activityReads,
        pages,
        wakes: wakes.length,
        editedDelivered: wakes.some((x) => x.includes("edited tail")),
      }),
    );
    expect(activityReads).toBe(2);
    expect(pages).toBe(2);
    expect(wakes.some((x) => x.includes("edited tail"))).toBe(true);
  }),
);
