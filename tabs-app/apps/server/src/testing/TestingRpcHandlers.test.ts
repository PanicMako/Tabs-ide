import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  TESTING_WS_METHODS,
  TestingWsRpcGroup,
  WS_METHODS,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/unstable/rpc/RpcTest";

import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import { TestingService } from "./TestingService.ts";
import { testingRpcHandlers } from "./TestingRpcHandlers.ts";

it.effect("preserves Testing mutations and persisted reads through authorized V2 RPC", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "tabs-testing-rpc-" });
    const service = yield* Effect.acquireRelease(
      Effect.sync(() => new TestingService(root)),
      (testing) => Effect.sync(() => testing.close()),
    );
    const clientFor = (scopes: Parameters<typeof RpcAuthorization.layer>[0]) =>
      RpcTest.makeClient(TestingWsRpcGroup).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestingWsRpcGroup.toLayer(testingRpcHandlers(service)),
            RpcAuthorization.layer(scopes),
          ),
        ),
      );
    const readOnly = yield* clientFor([AuthOrchestrationReadScope]);
    const input = {
      projectId: "project:testing-rpc",
      description: "RPC case",
      steps: ["Open page"],
      expectedResult: "Page appears",
    };
    expect(yield* readOnly[WS_METHODS.testingCreateCase](input).pipe(Effect.flip)).toMatchObject({
      _tag: "EnvironmentAuthorizationError",
      requiredScope: AuthOrchestrationOperateScope,
    });
    expect(
      yield* readOnly[WS_METHODS.testingListCases]({ projectId: input.projectId }),
    ).toMatchObject({ cases: [] });
    const writer = yield* clientFor([AuthOrchestrationReadScope, AuthOrchestrationOperateScope]);
    expect(yield* writer[WS_METHODS.testingCreateCase](input)).toMatchObject({
      cases: [expect.objectContaining({ description: "RPC case" })],
    });
    expect(
      yield* readOnly[WS_METHODS.testingListCases]({ projectId: input.projectId }),
    ).toMatchObject({
      cases: [expect.objectContaining({ description: "RPC case" })],
    });
    expect(
      yield* readOnly[WS_METHODS.testingGetStatus]({ projectId: input.projectId }),
    ).toMatchObject({ projectId: input.projectId });
    expect(new Set(TestingWsRpcGroup.requests.keys())).toEqual(
      new Set(Object.values(TESTING_WS_METHODS)),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
