import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import { makeCommandGate } from "./serverRuntimeStartup.ts";
it.effect("queued command executes even after its waiting caller is interrupted", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const gate = yield* makeCommandGate;
      const ran = yield* Deferred.make<void>();
      const count = yield* Ref.make(0);
      const caller = yield* gate
        .enqueueCommand(
          Ref.update(count, (n) => n + 1).pipe(Effect.andThen(Deferred.succeed(ran, undefined))),
        )
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(caller);
      expect(yield* Ref.get(count)).toBe(0);
      yield* gate.signalCommandReady;
      yield* Deferred.await(ran);
      expect(yield* Ref.get(count)).toBe(1);
    }),
  ),
);
