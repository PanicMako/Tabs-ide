import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Runner from "./processRunner.ts";

const live = Runner.layer.pipe(Layer.provide(NodeServices.layer));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
};
it.effect("interrupting real Effect process waits for owned child termination", () =>
  Effect.gen(function* () {
    const runner = yield* Runner.ProcessRunner;
    const announced = yield* Deferred.make<number>();
    let pid: number | undefined;
    let bytes = "";
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (pid !== undefined && alive(pid)) process.kill(pid, "SIGKILL");
      }),
    );
    const fiber = yield* runner
      .run({
        command: process.execPath,
        args: ["-e", "process.stdout.write(String(process.pid)+'\\n'); setInterval(()=>{},1000)"],
        onStdoutChunk: (chunk) => {
          bytes += Buffer.from(chunk).toString();
          if (bytes.includes("\n") && pid === undefined) {
            pid = Number(bytes.trim());
            Effect.runSync(Deferred.succeed(announced, pid));
          }
        },
        timeout: "5 seconds",
      })
      .pipe(Effect.forkScoped);
    const child = yield* Deferred.await(announced).pipe(Effect.timeout("3 seconds"));
    expect(alive(child)).toBe(true);
    yield* Fiber.interrupt(fiber);
    expect(alive(child)).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(live)),
);
