import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ServerConfig } from "../config.ts";
import { clearTelemetryIdentifier, getTelemetryIdentifier } from "./Identify.ts";

describe("Tabs Telemetry Identify", () => {
  it.effect("generates, persists and clears UUID identifier", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tmpDir = yield* fs.makeTempDirectoryScoped({ prefix: "tabs-identify-test-" });
      const testConfig = ServerConfig.layerTest(tmpDir, tmpDir);

      const id1 = yield* getTelemetryIdentifier.pipe(Effect.provide(testConfig));
      expect(id1).toBeTruthy();
      expect(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id1!),
      ).toBe(true);

      // Subsequent call reads same id
      const id2 = yield* getTelemetryIdentifier.pipe(Effect.provide(testConfig));
      expect(id2).toBe(id1);

      // Clearing deletes identifier
      yield* clearTelemetryIdentifier.pipe(Effect.provide(testConfig));
      const id3 = yield* getTelemetryIdentifier.pipe(Effect.provide(testConfig));
      expect(id3).toBeTruthy();
      expect(id3).not.toBe(id1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
