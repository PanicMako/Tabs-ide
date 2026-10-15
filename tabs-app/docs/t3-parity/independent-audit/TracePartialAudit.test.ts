import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Stream from "effect/Stream";
import * as TraceDiagnostics from "./TraceDiagnostics.ts";
it.effect("reports empty data when every stream fails after a valid line", () =>
  Effect.gen(function* () {
    const line =
      JSON.stringify({
        name: "audit",
        traceId: "t",
        spanId: "s",
        durationMs: 1,
        startTimeUnixNano: "1000000",
        endTimeUnixNano: "2000000",
      }) + "\n";
    const failure = PlatformError.systemError({
      _tag: "PermissionDenied",
      module: "FileSystem",
      method: "read",
      description: "audit failure",
      pathOrDescriptor: "/audit",
    });
    const fs = FileSystem.layerNoop({
      stream: () =>
        Stream.concat(Stream.make(new TextEncoder().encode(line)), Stream.fail(failure)),
    });
    const result = yield* TraceDiagnostics.readTraceDiagnostics({
      traceFilePath: "/audit",
      maxFiles: 0,
    }).pipe(Effect.provide(TraceDiagnostics.layer.pipe(Layer.provide(fs))));
    assert.equal(result.recordCount, 0);
    assert.equal(Option.getOrUndefined(result.error)?.kind, "trace-file-read-failed");
    assert.equal(Option.isNone(result.partialFailure), true);
  }),
);
