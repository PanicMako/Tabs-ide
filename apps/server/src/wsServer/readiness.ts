import { Deferred, Duration, Effect, Option } from "effect";

export interface ServerReadiness {
  readonly awaitServerReady: Effect.Effect<void>;
  readonly markHttpListening: Effect.Effect<void>;
  readonly markPushBusReady: Effect.Effect<void>;
  readonly markKeybindingsReady: Effect.Effect<void>;
  readonly markTerminalSubscriptionsReady: Effect.Effect<void>;
  readonly markOrchestrationSubscriptionsReady: Effect.Effect<void>;
}

const READINESS_TIMEOUT = Duration.minutes(1);

export const makeServerReadiness = Effect.gen(function* () {
  const httpListening = yield* Deferred.make<void>();
  const pushBusReady = yield* Deferred.make<void>();
  const keybindingsReady = yield* Deferred.make<void>();
  const terminalSubscriptionsReady = yield* Deferred.make<void>();
  const orchestrationSubscriptionsReady = yield* Deferred.make<void>();

  const complete = (deferred: Deferred.Deferred<void>) =>
    Deferred.succeed(deferred, undefined).pipe(Effect.orDie);

  const readyOrTimeout = (name: string, deferred: Deferred.Deferred<void>) =>
    Deferred.await(deferred).pipe(
      Effect.timeoutOption(READINESS_TIMEOUT),
      Effect.flatMap((option) =>
        Option.isNone(option) ? Effect.logWarning(`readiness timed out: ${name}`) : Effect.void,
      ),
    );

  return {
    awaitServerReady: Effect.all([
      readyOrTimeout("httpListening", httpListening),
      readyOrTimeout("pushBusReady", pushBusReady),
      readyOrTimeout("keybindingsReady", keybindingsReady),
      readyOrTimeout("terminalSubscriptionsReady", terminalSubscriptionsReady),
      readyOrTimeout("orchestrationSubscriptionsReady", orchestrationSubscriptionsReady),
    ]).pipe(Effect.asVoid),
    markHttpListening: complete(httpListening),
    markPushBusReady: complete(pushBusReady),
    markKeybindingsReady: complete(keybindingsReady),
    markTerminalSubscriptionsReady: complete(terminalSubscriptionsReady),
    markOrchestrationSubscriptionsReady: complete(orchestrationSubscriptionsReady),
  } satisfies ServerReadiness;
});
