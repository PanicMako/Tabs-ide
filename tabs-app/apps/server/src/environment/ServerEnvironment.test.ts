import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "./ServerEnvironment.ts";

const makeLayer = () =>
  ServerEnvironment.layer.pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "tabs-environment-test-" })),
    Layer.provide(NodeServices.layer),
  );

it.effect("persists one stable environment identity and advertises capabilities", () =>
  Effect.gen(function* () {
    const environment = yield* ServerEnvironment.ServerEnvironment;
    const first = yield* environment.getDescriptor;
    const second = yield* environment.getDescriptor;

    expect(first.environmentId).toBe(second.environmentId);
    expect(first.label.length).toBeGreaterThan(0);
    expect(first.capabilities.repositoryIdentity).toBe(true);
    expect(first.capabilities.connectionProbe).toBe(true);
  }).pipe(Effect.provide(makeLayer())),
);
