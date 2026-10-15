import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import { withWorkspaceLease } from "./workspaceLease.ts";
it.effect("cancels a waiting lease without blocking subsequent callers", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const count = yield* Ref.make(0);
      const holder = yield* withWorkspaceLease(
        "/audit/lease",
        Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
      ).pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      const waiter = yield* withWorkspaceLease(
        "/audit/lease",
        Ref.update(count, (n) => n + 1),
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(waiter);
      expect(yield* Ref.get(count)).toBe(0);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(holder);
      yield* withWorkspaceLease(
        "/audit/lease",
        Ref.update(count, (n) => n + 1),
      );
      expect(yield* Ref.get(count)).toBe(1);
    }),
  ),
);
it.effect("serializes same cwd while allowing different cwd", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const count = yield* Ref.make(0);
      const holder = yield* withWorkspaceLease(
        "/audit/same",
        Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
      ).pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      const waiter = yield* withWorkspaceLease(
        "/audit/same",
        Ref.update(count, (n) => n + 1),
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      expect(yield* Ref.get(count)).toBe(0);
      yield* withWorkspaceLease(
        "/audit/other",
        Ref.update(count, (n) => n + 10),
      );
      expect(yield* Ref.get(count)).toBe(10);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(holder);
      yield* Fiber.join(waiter);
      expect(yield* Ref.get(count)).toBe(11);
    }),
  ),
);
