// Effect service in front of the session-search worker. The index lives in
// `<stateDir>/session-search.sqlite`; the worker is spawned on first use, never at startup.
import {
  SessionSearchError,
  type SessionSearchPreviewInput,
  type SessionSearchPreviewResult,
  type SessionSearchQueryInput,
  type SessionSearchQueryResult,
  type SessionSearchReindexInput,
  type SessionSearchResumeInput,
  type SessionSearchResumeResult,
  type SessionSearchStatus,
} from "@tabs/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import { defaultRoots, type SessionSearchRoots } from "./discovery.ts";
import { resumeResult } from "./resume.ts";
import { SessionSearchWorkerClient, type WorkerFactory } from "./WorkerClient.ts";

export class SessionSearchService extends Context.Service<
  SessionSearchService,
  {
    readonly query: (
      input: SessionSearchQueryInput,
    ) => Effect.Effect<SessionSearchQueryResult, SessionSearchError>;
    readonly status: Effect.Effect<SessionSearchStatus, SessionSearchError>;
    readonly reindex: (
      input: SessionSearchReindexInput,
    ) => Effect.Effect<SessionSearchStatus, SessionSearchError>;
    readonly preview: (
      input: SessionSearchPreviewInput,
    ) => Effect.Effect<SessionSearchPreviewResult, SessionSearchError>;
    readonly resume: (
      input: SessionSearchResumeInput,
    ) => Effect.Effect<SessionSearchResumeResult, SessionSearchError>;
  }
>()("tabs/sessionSearch/SessionSearchService") {}

export interface MakeOptions {
  readonly dbPath: string;
  readonly roots?: SessionSearchRoots;
  readonly workerFactory?: WorkerFactory;
}

export const makeWithOptions = (options: MakeOptions) =>
  Effect.gen(function* () {
    const client = new SessionSearchWorkerClient(
      { dbPath: options.dbPath, roots: options.roots ?? defaultRoots() },
      options.workerFactory,
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => client.shutdown()));
    const call = <A>(label: string, run: () => Promise<A>) =>
      Effect.tryPromise({
        try: run,
        catch: (cause) =>
          new SessionSearchError({
            message: cause instanceof Error ? cause.message : `Session search ${label} failed.`,
            cause,
          }),
      });
    return SessionSearchService.of({
      query: (input) => call("query", () => client.query(input)),
      status: call("status", () => client.status()),
      reindex: (input) => call("reindex", () => client.reindex(input.full === true)),
      preview: (input) => call("preview", () => client.preview(input)),
      resume: (input) =>
        call("resume", () => client.getSession(input.agent, input.sessionId)).pipe(
          Effect.flatMap((stored) =>
            stored
              ? Effect.succeed(resumeResult(stored))
              : Effect.fail(
                  new SessionSearchError({ message: "That session is no longer in the index." }),
                ),
          ),
        ),
    });
  });

export const layer = Layer.effect(
  SessionSearchService,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return yield* makeWithOptions({ dbPath: path.join(config.stateDir, "session-search.sqlite") });
  }),
);
