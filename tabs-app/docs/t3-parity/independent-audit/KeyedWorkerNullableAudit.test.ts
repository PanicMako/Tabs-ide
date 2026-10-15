import { it } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { makeKeyedCoalescingWorker } from "./KeyedCoalescingWorker.ts";
describe("nullable payload audit", () => {
  it.live("processes undefined", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const seen: unknown[] = [];
        const worker = yield* makeKeyedCoalescingWorker<string, undefined, never, never>({
          merge: (_, next) => next,
          process: (_, value) =>
            Effect.sync(() => {
              seen.push(value);
            }),
        });
        yield* worker.enqueue("key", undefined);
        yield* Effect.sleep(20);
        expect(seen).toEqual([undefined]);
      }),
    ),
  );
  it.live("processes pending null and drains", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const seen: unknown[] = [];
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const worker = yield* makeKeyedCoalescingWorker<string, string | null, never, never>({
          merge: (_, next) => next,
          process: (_, value) =>
            Effect.gen(function* () {
              seen.push(value);
              if (value === "first") {
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(release);
              }
            }),
        });
        yield* worker.enqueue("key", "first");
        yield* Deferred.await(started);
        yield* worker.enqueue("key", null);
        yield* Deferred.succeed(release, undefined);
        const drained = yield* Effect.race(
          worker.drainKey("key").pipe(Effect.as(true)),
          Effect.sleep(30).pipe(Effect.as(false)),
        );
        expect({ seen, drained }).toEqual({ seen: ["first", null], drained: true });
      }),
    ),
  );
});
