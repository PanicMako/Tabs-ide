import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { ProviderInstanceId } from "@tabs/contracts";

import * as Gate from "./ProviderInstallationGate.ts";

const a = ProviderInstanceId.make("a");
const b = ProviderInstanceId.make("b");

describe("ProviderInstallationGate", () => {
  it.effect("lets work of one instance run side by side", () =>
    Effect.gen(function* () {
      const gate = yield* Gate.ProviderInstallationGate;
      const release = yield* Deferred.make<void>();
      const first = yield* gate.execute(a, Deferred.await(release)).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      const second = yield* gate.execute(a, Effect.succeed("done"));
      assert.equal(second, "done");
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(first);
    }).pipe(Effect.provide(Gate.layer)),
  );

  it.effect("makes an update wait for running work and holds back new work", () =>
    Effect.gen(function* () {
      const gate = yield* Gate.ProviderInstallationGate;
      const order: Array<string> = [];
      const release = yield* Deferred.make<void>();
      const running = yield* gate
        .execute(
          a,
          Deferred.await(release).pipe(
            Effect.tap(() => Effect.sync(() => order.push("work-done"))),
          ),
        )
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      const update = yield* gate
        .update(
          [a],
          Effect.sync(() => order.push("update")),
        )
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      const later = yield* gate
        .execute(
          a,
          Effect.sync(() => order.push("later")),
        )
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      assert.deepEqual(order, []);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.joinAll([running, update, later]);
      assert.deepEqual(order, ["work-done", "update", "later"]);
    }).pipe(Effect.provide(Gate.layer)),
  );

  it.effect("does not block other instances during an update", () =>
    Effect.gen(function* () {
      const gate = yield* Gate.ProviderInstallationGate;
      const release = yield* Deferred.make<void>();
      const update = yield* gate.update([a], Deferred.await(release)).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      assert.equal(yield* gate.execute(b, Effect.succeed(1)), 1);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(update);
    }).pipe(Effect.provide(Gate.layer)),
  );

  it.effect("runs unguarded when no gate is provided", () =>
    Effect.gen(function* () {
      assert.equal(yield* Gate.executeWhenGated(a, Effect.succeed(7)), 7);
      assert.equal(yield* Gate.updateWhenGated([a], Effect.succeed(8)), 8);
    }),
  );
});
