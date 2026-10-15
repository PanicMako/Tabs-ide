import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";
import { TextGeneration } from "../textGeneration/TextGeneration.ts";
import { TestingService } from "./TestingService.ts";

/** Testing jobs belong to the environment, rather than one websocket connection. */
export class TestingRuntime extends Context.Service<TestingRuntime, TestingService>()(
  "tabs/testing/TestingRuntime",
) {}

export const layer = Layer.effect(
  TestingRuntime,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const textGeneration = yield* TextGeneration;
    return yield* Effect.acquireRelease(
      Effect.sync(() => new TestingService(config.stateDir, textGeneration)),
      (service) => Effect.promise(() => service.close()),
    );
  }),
);
