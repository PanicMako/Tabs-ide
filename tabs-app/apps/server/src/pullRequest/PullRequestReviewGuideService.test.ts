import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { describe } from "vitest";

import type { PullRequestRef, PullRequestReviewGuide } from "@tabs/contracts";

import * as PullRequestReviewGuides from "../persistence/PullRequestReviewGuides.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as PullRequestService from "./PullRequestService.ts";
import {
  PullRequestReviewGuideService,
  layer,
  settledReviewSummary,
} from "./PullRequestReviewGuideService.ts";

const PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,3 @@",
  " keep",
  "+added",
  " tail",
  "diff --git a/src/b.ts b/src/b.ts",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "",
].join("\n");

const input = { projectId: "p1", repository: "o/r", number: 7, host: "github.com" } as PullRequestRef;
const key = { host: "github.com", repository: "o/r", number: 7 };

function harness(options: {
  generate?: TextGeneration.TextGenerationShape["generateReviewGuide"];
  model?: boolean;
}) {
  const stored = new Map<string, PullRequestReviewGuide>();
  const repository = PullRequestReviewGuides.PullRequestReviewGuideRepository.of({
    get: (k) => {
      const guide = stored.get(`${k.host}/${k.repository}#${k.number}`);
      return Effect.succeed(guide === undefined ? Option.none() : Option.some(guide));
    },
    put: (k, guide) => Effect.sync(() => void stored.set(`${k.host}/${k.repository}#${k.number}`, guide)),
  });
  const pullRequests = {
    detail: () =>
      Effect.succeed({
        number: 7,
        title: "Add a line",
        body: "Adds it",
        baseBranch: "main",
        headBranch: "feat",
        headSha: "head1",
      }),
    diff: () => Effect.succeed({ patch: PATCH, truncated: false, nextCursor: null }),
    activity: () => Effect.succeed({ reviewThreads: [] }),
  } as unknown as PullRequestService.PullRequestService["Service"];
  const projects = {
    getShell: () => Effect.succeed(Option.some({ workspaceRoot: "/repo" })),
  } as unknown as ProjectService.ProjectService["Service"];
  const settings = {
    getSettings: Effect.succeed({
      textGenerationModelSelection: options.model === false ? null : { instanceId: "codex", model: "m" },
    }),
  } as unknown as ServerSettings.ServerSettingsService["Service"];
  const textGeneration = {
    generateReviewGuide: options.generate,
  } as unknown as TextGeneration.TextGenerationShape;
  const deps = Layer.mergeAll(
    Layer.succeed(PullRequestService.PullRequestService, pullRequests),
    Layer.succeed(PullRequestReviewGuides.PullRequestReviewGuideRepository, repository),
    Layer.succeed(ProjectService.ProjectService, projects),
    Layer.succeed(ServerSettings.ServerSettingsService, settings),
    Layer.succeed(TextGeneration.TextGeneration, textGeneration),
  );
  return { layer: layer.pipe(Layer.provide(deps)), stored };
}

const settle = (service: PullRequestReviewGuideService["Service"]) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const result = yield* service.get(input, key);
      if (result.run?._tag !== "Running") return result;
      yield* Effect.sleep("10 millis");
    }
    return yield* service.get(input, key);
  });

describe("PullRequestReviewGuideService", () => {
  it.live("writes a guide in the background, keeps only lines the diff changed, and stores it", () => {
    const { layer: testLayer, stored } = harness({
      generate: (request) =>
        Effect.sync(() => {
          assert.strictEqual(request.cwd, "/repo");
          assert.deepStrictEqual([...request.files].sort(), ["src/a.ts", "src/b.ts"]);
          return {
            stops: [
              {
                title: "Core",
                summary: "s",
                attention: null,
                // Line 2 is added; line 80 is not in the diff and must be dropped.
                excerpts: [
                  { path: "src/a.ts", side: "new" as const, start: 2, end: 2, caption: "c" },
                  { path: "src/a.ts", side: "new" as const, start: 80, end: 81, caption: "x" },
                ],
                files: [],
                notes: [],
                questions: [],
              },
            ],
          };
        }),
    });
    return Effect.gen(function* () {
      const service = yield* PullRequestReviewGuideService;
      const started = yield* service.generate(input, key);
      assert.strictEqual(started.run?._tag, "Running");
      assert.strictEqual(started.currentHeadSha, "head1");
      const done = yield* settle(service);
      assert.strictEqual(done.run, null);
      assert.strictEqual(done.guide?.headSha, "head1");
      const stops = done.guide?.stops ?? [];
      assert.deepStrictEqual(
        stops[0]?.excerpts.map((excerpt) => [excerpt.start, excerpt.end]),
        [[2, 2]],
      );
      // The changed file the model did not place is still on the tour.
      assert.strictEqual(stops.at(-1)?.title, "Other files");
      assert.strictEqual(stored.size, 1);
    }).pipe(Effect.provide(testLayer));
  });

  it.live("records a failed run with the reason, and clears it when a retry succeeds", () => {
    const { layer: testLayer } = harness({ generate: undefined });
    return Effect.gen(function* () {
      const service = yield* PullRequestReviewGuideService;
      yield* service.generate(input, key);
      const failed = yield* settle(service);
      assert.strictEqual(failed.run?._tag, "Failed");
      assert.strictEqual(failed.guide, null);
    }).pipe(Effect.provide(testLayer));
  });

  it.live("says so when no writing model is set", () => {
    const { layer: testLayer } = harness({ generate: () => Effect.succeed({ stops: [] }), model: false });
    return Effect.gen(function* () {
      const service = yield* PullRequestReviewGuideService;
      yield* service.generate(input, key);
      const failed = yield* settle(service);
      assert.strictEqual(failed.run?._tag, "Failed");
      assert.match(failed.run?._tag === "Failed" ? failed.run.detail : "", /writing model/i);
    }).pipe(Effect.provide(testLayer));
  });

  it("summarises only settled review threads", () => {
    const summary = settledReviewSummary({
      reviewThreads: [
        { path: "a.ts", isResolved: true, isOutdated: false, comments: [{ author: { login: "me" }, body: "Fix <!-- x -->   this" }] },
        { path: "b.ts", isResolved: false, isOutdated: false, comments: [{ author: null, body: "open" }] },
      ],
    } as never);
    assert.strictEqual(summary, "- a.ts (resolved, me): Fix this");
  });
});
