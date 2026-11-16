import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import {
  PullRequestOperationError,
  type PullRequestActivity,
  type PullRequestRef,
  type PullRequestReviewGuide,
  type PullRequestReviewGuideResult,
  type PullRequestReviewGuideRun,
  type ThreadPullRequestKey,
} from "@tabs/contracts";

import * as PullRequestReviewGuides from "../persistence/PullRequestReviewGuides.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as PullRequestService from "./PullRequestService.ts";
import { normalizeReviewGuide, parseReviewGuideChange } from "./pullRequestReviewGuideNormalize.ts";

/** Slices of one diff read for a guide: enough for a large change, bounded so a run ends. */
const MAX_DIFF_SLICES = 8;
const SETTLED_REMARK_CHARS = 200;

export class PullRequestReviewGuideService extends Context.Service<
  PullRequestReviewGuideService,
  {
    /** The guide stored for a pull request, the run in progress or last failed, and its head. */
    readonly get: (
      input: PullRequestRef,
      key: ThreadPullRequestKey,
    ) => Effect.Effect<PullRequestReviewGuideResult, PullRequestService.PullRequestError>;
    /**
     * Starts writing a guide and answers at once with the run it started, or with the run
     * already going. The guide itself arrives through `get`, written when the model is done.
     */
    readonly generate: (
      input: PullRequestRef,
      key: ThreadPullRequestKey,
    ) => Effect.Effect<PullRequestReviewGuideResult, PullRequestService.PullRequestError>;
  }
>()("tabs/pullRequest/PullRequestReviewGuideService") {}

const keyString = (key: ThreadPullRequestKey) => `${key.host}/${key.repository}#${key.number}`;

const nowIso = Clock.currentTimeMillis.pipe(
  Effect.map((millis) => DateTime.formatIso(DateTime.makeUnsafe(millis))),
);

const oneLine = (text: string): string => {
  const flat = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > SETTLED_REMARK_CHARS ? `${flat.slice(0, SETTLED_REMARK_CHARS)}…` : flat;
};

/** Threads already resolved or outdated, so the guide does not raise them again. */
export function settledReviewSummary(activity: PullRequestActivity): string {
  return activity.reviewThreads
    .filter((thread) => thread.isResolved || thread.isOutdated)
    .flatMap((thread) => {
      const opener = thread.comments[0];
      if (opener === undefined) return [];
      const who = opener.author?.login ?? "ghost";
      const state = thread.isResolved ? "resolved" : "outdated";
      return [`- ${thread.path} (${state}, ${who}): ${oneLine(opener.body)}`];
    })
    .join("\n");
}

const make = Effect.gen(function* () {
  const pullRequests = yield* PullRequestService.PullRequestService;
  const guides = yield* PullRequestReviewGuides.PullRequestReviewGuideRepository;
  const projects = yield* ProjectService.ProjectService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const serviceScope = yield* Effect.scope;
  const runs = yield* Ref.make<ReadonlyMap<string, PullRequestReviewGuideRun>>(new Map());

  const fail = (operation: string, detail: string, cause?: unknown) =>
    new PullRequestOperationError({
      operation,
      detail,
      ...(cause === undefined ? {} : { cause }),
    });

  const readStored = (key: ThreadPullRequestKey) =>
    guides.get(key).pipe(
      Effect.mapError((cause) =>
        fail("reviewGuide", "Could not read the stored review guide.", cause),
      ),
      Effect.map(Option.getOrNull),
    );

  const state = (
    key: ThreadPullRequestKey,
    guide: PullRequestReviewGuide | null,
    currentHeadSha: string | null,
  ) =>
    Ref.get(runs).pipe(
      Effect.map(
        (current): PullRequestReviewGuideResult => ({
          guide,
          run: current.get(keyString(key)) ?? null,
          currentHeadSha,
        }),
      ),
    );

  const get: PullRequestReviewGuideService["Service"]["get"] = (input, key) =>
    Effect.all([readStored(key), pullRequests.detail(input)], { concurrency: 2 }).pipe(
      Effect.flatMap(([guide, detail]) => state(key, guide, detail.headSha ?? null)),
    );

  /** The whole diff, slice by slice, as one patch. */
  const readPatch = Effect.fn("PullRequestReviewGuideService.readPatch")(function* (
    input: PullRequestRef,
  ) {
    const parts: string[] = [];
    let cursor: string | undefined;
    for (let slice = 0; slice < MAX_DIFF_SLICES; slice += 1) {
      const result = yield* pullRequests.diff({ ...input, ...(cursor ? { cursor } : {}) });
      parts.push(result.patch);
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    return parts.join("\n");
  });

  const write = Effect.fn("PullRequestReviewGuideService.write")(function* (
    input: PullRequestRef,
    key: ThreadPullRequestKey,
    headSha: string,
  ) {
    const [detail, patch, activity, settings] = yield* Effect.all(
      [
        pullRequests.detail(input),
        readPatch(input),
        pullRequests.activity(input).pipe(Effect.option),
        serverSettings.getSettings.pipe(
          Effect.mapError((cause) =>
            fail("generateReviewGuide", "Could not read settings.", cause),
          ),
        ),
      ],
      { concurrency: "unbounded" },
    );
    const modelSelection = settings.textGenerationModelSelection;
    if (modelSelection === null || modelSelection === undefined) {
      return yield* fail(
        "generateReviewGuide",
        "No writing model is set. Pick one in Settings before writing a review guide.",
      );
    }
    if (patch.trim().length === 0) {
      return yield* fail("generateReviewGuide", "This pull request has no changes to guide.");
    }
    const change = parseReviewGuideChange("", patch);
    const files = [...change.hunks.keys()];
    const generate = textGeneration.generateReviewGuide;
    if (generate === undefined) {
      return yield* fail("generateReviewGuide", "The writing model cannot write review guides.");
    }
    const workspaceRoot = yield* projects.getShell(input.projectId).pipe(
      Effect.map((shell) => Option.getOrUndefined(shell)?.workspaceRoot),
      Effect.orElseSucceed(() => undefined),
    );
    const generated = yield* generate({
      cwd: workspaceRoot ?? process.cwd(),
      number: detail.number,
      title: detail.title,
      description: detail.body ?? "",
      baseBranch: detail.baseBranch,
      headBranch: detail.headBranch,
      files,
      patch,
      settledReview: Option.match(activity, {
        onNone: () => "",
        onSome: settledReviewSummary,
      }),
      instructions: "",
      modelSelection,
    }).pipe(
      Effect.mapError((cause) =>
        fail("generateReviewGuide", cause.detail ?? "The writing model failed.", cause),
      ),
    );
    const normalized = normalizeReviewGuide(generated, { files, hunks: change.hunks });
    const guide: PullRequestReviewGuide = {
      headSha,
      generatedAt: yield* nowIso,
      modelSelection,
      stops: normalized.stops,
    };
    yield* guides
      .put(key, guide)
      .pipe(
        Effect.mapError((cause) =>
          fail("generateReviewGuide", "Could not store the guide.", cause),
        ),
      );
  });

  const generate: PullRequestReviewGuideService["Service"]["generate"] = Effect.fn(
    "PullRequestReviewGuideService.generate",
  )(function* (input, key) {
    const detail = yield* pullRequests.detail(input);
    const headSha = detail.headSha;
    if (headSha === undefined) {
      return yield* fail(
        "generateReviewGuide",
        "The host did not report this pull request's head.",
      );
    }
    const id = keyString(key);
    const already = (yield* Ref.get(runs)).get(id);
    if (already?._tag === "Running") {
      return yield* state(key, yield* readStored(key), headSha);
    }
    const startedAt = yield* nowIso;
    yield* Ref.update(runs, (current) =>
      new Map(current).set(id, { _tag: "Running", headSha, startedAt }),
    );
    // The model takes minutes; the caller is answered now and watches `get` for the result.
    yield* write(input, key, headSha).pipe(
      Effect.matchEffect({
        onSuccess: () =>
          Ref.update(runs, (current) => {
            const next = new Map(current);
            next.delete(id);
            return next;
          }),
        onFailure: (error) =>
          nowIso.pipe(
            Effect.flatMap((failedAt) =>
              Ref.update(runs, (current) =>
                new Map(current).set(id, {
                  _tag: "Failed",
                  headSha,
                  failedAt,
                  detail:
                    "detail" in error && error.detail
                      ? error.detail
                      : "The guide could not be written.",
                }),
              ),
            ),
          ),
      }),
      Effect.forkIn(serviceScope),
    );
    return yield* state(key, yield* readStored(key), headSha);
  });

  return PullRequestReviewGuideService.of({ get, generate });
});

export const layer = Layer.effect(PullRequestReviewGuideService, make);
