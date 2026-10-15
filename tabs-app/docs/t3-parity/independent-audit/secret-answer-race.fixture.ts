import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  type OrchestrationV2ServerCommand,
  ThreadId,
  TurnItemId,
} from "@tabs/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as TestClock from "effect/testing/TestClock";
import * as Tracer from "effect/Tracer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SecretRequests from "./SecretRequests.ts";

const threadId = ThreadId.make("thread-orchestrator");
const turnItemId = TurnItemId.make("turn-item:secret-request:1");
const projectId = ProjectId.make("project-1");

/** Runs `body` against the service with an in-memory store and a thread holding one request. */
const withService = <A, E>(
  body: (input: {
    readonly service: SecretRequests.SecretRequests["Service"];
    readonly stored: Map<string, Uint8Array>;
    readonly dispatched: Array<OrchestrationV2ServerCommand>;
  }) => Effect.Effect<A, E>,
  options: {
    readonly threadId?: ThreadId;
    readonly runStatus?: string;
    readonly removeFails?: boolean;
    /** The agent's wait closes the card just before the answer's record lands. */
    readonly closedFirst?: boolean;
    /** How many record dispatches fail before one succeeds. */
    readonly failedRecords?: number;
    readonly firstEntered?: Deferred.Deferred<void>;
    readonly releaseFirst?: Deferred.Deferred<void>;
  } = {},
) =>
  Effect.gen(function* () {
    const stored = new Map<string, Uint8Array>();
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    let secretStatus = "pending";
    let failedRecords = options.failedRecords ?? 0;
    let dispatchCount = 0;
    const requestThreadId = options.threadId ?? threadId;
    const layerDependencies = Layer.mergeAll(
      NodeCrypto.layer,
      NodeServices.layer,
      Layer.succeed(
        ServerSecretStore.ServerSecretStore,
        ServerSecretStore.ServerSecretStore.of({
          // Yields like a real file read, so concurrent callers can interleave.
          get: (name) => Effect.yieldNow.pipe(Effect.as(Option.fromNullishOr(stored.get(name)))),
          set: (name, value) => Effect.sync(() => void stored.set(name, value)),
          create: (name, value) =>
            stored.has(name)
              ? Effect.fail(
                  new ServerSecretStore.SecretStorePersistError({
                    resource: name,
                    cause: new PlatformError.PlatformError(
                      new PlatformError.SystemError({
                        _tag: "AlreadyExists",
                        module: "FileSystem",
                        method: "open",
                      }),
                    ),
                  } as never),
                )
              : Effect.sync(() => void stored.set(name, value)),
          getOrCreateRandom: (name, bytes) =>
            Effect.sync(() => {
              const existing = stored.get(name);
              if (existing) return existing;
              const value = new Uint8Array(bytes).fill(7);
              stored.set(name, value);
              return value;
            }),
          remove: (name) =>
            options.removeFails
              ? Effect.fail(
                  new ServerSecretStore.SecretStorePersistError({
                    resource: name,
                    cause: new Error("read-only"),
                  }),
                )
              : Effect.sync(() => void stored.delete(name)),
        }),
      ),
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadRecords: () =>
          Effect.succeed({
            thread: { projectId },
            runs: [{ id: "run-1", status: options.runStatus ?? "running" }],
            turnItems: [
              {
                id: turnItemId,
                threadId: requestThreadId,
                runId: "run-1",
                nodeId: "node-root",
                type: "secret_request",
                label: "GitHub token",
                reason: "Used as GH_TOKEN.",
                secretStatus,
              },
            ],
          } as never),
        dispatch: (command) => {
          dispatchCount += 1;
          if (dispatchCount === 1 && options.firstEntered && options.releaseFirst)
            return Deferred.succeed(options.firstEntered, undefined).pipe(
              Effect.andThen(Deferred.await(options.releaseFirst)),
              Effect.andThen(Effect.fail(new Error("first dispatch fails") as never)),
            );
          if (command.type === "secret_request.record" && failedRecords > 0) {
            failedRecords -= 1;
            return Effect.fail(new Error("orchestrator unavailable") as never);
          }
          return Effect.sync(() => {
            dispatched.push(command);
            // Like the orchestrator, a card that is no longer pending keeps its answer.
            if (options.closedFirst && command.type === "secret_request.record") {
              secretStatus = "cancelled";
            } else if (command.type === "secret_request.record" && secretStatus === "pending") {
              secretStatus = command.secretStatus;
            }
            return {} as never;
          });
        },
      }),
    );
    return yield* Effect.gen(function* () {
      const service = yield* SecretRequests.SecretRequests;
      return yield* body({ service, stored, dispatched });
    }).pipe(Effect.provide(SecretRequests.layer.pipe(Layer.provide(layerDependencies))));
  });

/** The secret values in the store, leaving out the server's own salt. */
const valuesOf = (stored: Map<string, Uint8Array>) =>
  Array.from(stored.entries())
    .filter(([name]) => name !== "secret-request-salt")
    .map(([, bytes]) => new TextDecoder().decode(bytes));

it.effect("diagnostic: failed first answer cleans successful concurrent answer", () =>
  Effect.gen(function* () {
    const firstEntered = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    yield* withService(
      ({ service, stored }) =>
        Effect.gen(function* () {
          const first = yield* service
            .answer({ threadId, turnItemId, answer: { type: "save", secret: "first-value" } })
            .pipe(Effect.result, Effect.forkChild);
          yield* Deferred.await(firstEntered);
          yield* service.answer({
            threadId,
            turnItemId,
            answer: { type: "save", secret: "second-value" },
          });
          assert.isTrue(Option.isSome(yield* service.savedRef({ threadId, turnItemId })));
          yield* Deferred.succeed(releaseFirst, undefined);
          const result = yield* Fiber.join(first);
          assert.equal(result._tag, "Failure");
          assert.isTrue(Option.isNone(yield* service.savedRef({ threadId, turnItemId })));
          console.log(
            "DIAGNOSTIC: second answer returned success; first failure cleanup removed saved ref",
          );
        }),
      { firstEntered, releaseFirst },
    );
  }),
);
