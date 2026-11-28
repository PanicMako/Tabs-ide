import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import {
  AuthSessionId,
  DeviceComparisonError,
  DeviceComparisonInput,
  DeviceComparisonStatus,
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type DeviceComparisonFrame,
  type DeviceServiceState,
  type PreviewAutomationRequest,
  type PreviewAutomationStreamEvent,
} from "@tabs/contracts";
import * as CodexClient from "effect-codex-app-server/client";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { McpProtocol, McpSchema, McpServer } from "effect/unstable/ai";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { chromium, type Page } from "playwright";
import { expect, it, onTestFinished, vi } from "vitest";

import { startDeviceDraftApp, verifyCheckoutTrial } from "../../scripts/fixtures/deviceDraft.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { layerDeviceToolkit, makeMcpAuthMiddleware } from "../mcp/McpHttpServer.ts";
import {
  McpInvocationContext,
  type McpThreadInvocationScope,
} from "../mcp/McpInvocationContext.ts";
import { McpSessionRegistry, layer as layerMcpSessionRegistry } from "../mcp/McpSessionRegistry.ts";
import {
  PreviewAutomationBroker,
  make as makePreviewAutomationBroker,
} from "../mcp/PreviewAutomationBroker.ts";
import { makeDeviceComparison } from "./DeviceComparison.ts";
import { makeDeviceComparisonStore } from "./DeviceComparisonStore.ts";
import { DeviceService } from "./DeviceService.ts";
import type { SemanticDriver, SemanticSnapshot } from "./DeviceSemanticDriver.ts";

const threadId = ThreadId.make("guest-checkout-fixture");
const personalTabId = "agents-surface-checkout-personal";
const checkoutEnvironmentId = EnvironmentId.make("checkout-fixture");
const fixtureCaller = {
  threadId,
  providerSessionId: "checkout-fixture-session",
  providerInstanceId: ProviderInstanceId.make("codex"),
};
const localScope: McpThreadInvocationScope = {
  environmentId: checkoutEnvironmentId,
  thread: fixtureCaller,
  requestNamespace: fixtureCaller.providerSessionId,
  capabilities: new Set(["device", "preview"]),
  client: undefined,
  issuedAt: 0,
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "checkout-fixture", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "checkout-fixture", version: "1" },
  },
  getClient: Effect.die("unused"),
});

async function prepareCodexCheckout(binary: string, directory: string) {
  const resources = await Effect.runPromise(Scope.make());
  const close = () => Effect.runPromise(Scope.close(resources, Exit.void));
  try {
    const { http, registry, credential, invocation } = await Effect.runPromise(
      Effect.gen(function* () {
        const http = yield* Layer.build(
          NodeHttpServer.layer(createServer, { host: "127.0.0.1", port: 0 }),
        );
        const authority = yield* Layer.build(
          layerMcpSessionRegistry.pipe(
            Layer.provide(
              Layer.succeed(ServerEnvironment, {
                getEnvironmentId: Effect.succeed(checkoutEnvironmentId),
                getDescriptor: Effect.die("unused"),
              }),
            ),
          ),
        ).pipe(Effect.provide(http));
        const registry = Context.get(authority, McpSessionRegistry);
        const { config: credential } = yield* registry.issue({
          threadId,
          providerInstanceId: fixtureCaller.providerInstanceId,
          capabilities: new Set(["preview", "device"]),
        });
        const invocation = yield* registry.resolve(credential.authorizationHeader.slice(7));
        if (!invocation?.thread) throw new Error("Missing checkout fixture credential");
        return {
          http,
          registry,
          credential,
          invocation: { ...invocation, thread: invocation.thread },
        };
      }).pipe(Effect.provide(NodeServices.layer), Effect.provideService(Scope.Scope, resources)),
    );
    return {
      invocation,
      close,
      start: (toolLayer: Layer.Layer<McpServer.McpServer, unknown>) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const routes = McpServer.layerHttp({
              protocols: [McpProtocol.v2025_06_18],
              name: "Tabs checkout fixture",
              version: "1",
              path: "/mcp",
            }).pipe(
              Layer.provide(
                HttpRouter.middleware<{ provides: McpInvocationContext }>()(makeMcpAuthMiddleware)
                  .layer,
              ),
              Layer.provide(toolLayer),
            );
            yield* Layer.build(
              HttpRouter.serve(routes, {
                disableListenLog: true,
                disableLogger: true,
              }),
            ).pipe(Effect.provideService(McpSessionRegistry, registry), Effect.provide(http));
            const address = Context.get(http, HttpServer.HttpServer).address;
            if (address._tag !== "TcpAddress") throw new Error("Expected a loopback listener");
            expect(credential.endpoint).toBe(`http://127.0.0.1:${address.port}/mcp`);
            const unauthorized = yield* Effect.promise(() => fetch(credential.endpoint));
            expect(unauthorized.status).toBe(401);
            yield* Effect.promise(() => unauthorized.text());

            const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
            const processHandle = yield* spawner.spawn(
              ChildProcess.make(binary, ["app-server"], {
                cwd: directory,
                env: {
                  PATH: process.env.PATH,
                  HOME: directory,
                  CODEX_HOME: directory,
                  TMPDIR: directory,
                  HTTP_PROXY: "http://127.0.0.1:1",
                  HTTPS_PROXY: "http://127.0.0.1:1",
                  ALL_PROXY: "http://127.0.0.1:1",
                  NO_PROXY: "127.0.0.1",
                  GIT_CONFIG_NOSYSTEM: "1",
                },
                extendEnv: false,
              }),
            );
            const app = Context.get(
              yield* Layer.build(CodexClient.layerChildProcess(processHandle)),
              CodexClient.CodexAppServerClient,
            );
            yield* app
              .request("initialize", {
                clientInfo: {
                  name: "tabs-checkout-test",
                  version: "1",
                  title: "Tabs checkout test",
                },
                capabilities: { experimentalApi: true },
              })
              .pipe(Effect.timeout("5 seconds"), Effect.withSpan("checkout codex initialize"));
            yield* app.notify("initialized", undefined);
            const { thread } = yield* app
              .request("thread/start", {
                cwd: directory,
                ephemeral: true,
                config: {
                  features: { plugins: false },
                  analytics: { enabled: false },
                  model_provider: "checkout-fixture",
                  model_providers: {
                    "checkout-fixture": {
                      name: "Checkout fixture",
                      base_url: `http://127.0.0.1:${address.port}/unused`,
                      wire_api: "responses",
                      requires_openai_auth: false,
                    },
                  },
                  mcp_servers: {
                    "t3-code": {
                      url: credential.endpoint,
                      http_headers: {
                        Authorization: credential.authorizationHeader,
                      },
                    },
                  },
                },
              })
              .pipe(Effect.timeout("6 seconds"), Effect.withSpan("checkout codex thread"));
            expect(thread.ephemeral).toBe(true);
            return (name: string, args: Record<string, unknown>) =>
              Effect.runPromise(
                app
                  .request("mcpServer/tool/call", {
                    threadId: thread.id,
                    server: "t3-code",
                    tool: name,
                    arguments: Schema.decodeUnknownSync(Schema.Json)(args),
                  })
                  .pipe(Effect.timeout("6 seconds")),
              );
          }).pipe(
            Effect.provide(NodeServices.layer),
            Effect.provideService(Scope.Scope, resources),
          ),
        ),
    };
  } catch (cause) {
    await close();
    throw cause;
  }
}

// Chromium supplies the fixture's accessibility tree and PNG. Native app drivers
// are evaluated separately. Each tap uses the element ID from that same snapshot.
async function browserDevice(page: Page, appId: string, includeScreenGeometry: boolean) {
  const cdp = await page.context().newCDPSession(page);
  const viewport = includeScreenGeometry ? page.viewportSize()! : undefined;
  const applicationRoot = viewport && {
    index: 0,
    ref: "e0",
    type: "Application",
    bundleId: appId,
    rect: { x: 0, y: 0, ...viewport },
    visibleToUser: true,
  };
  let generation = 0;
  const backendIds = new Map<string, number>();
  return {
    async snapshot(): Promise<SemanticSnapshot> {
      const { nodes } = await cdp.send("Accessibility.getFullAXTree");
      const refsGeneration = ++generation;
      backendIds.clear();
      const semanticNodes = await Promise.all(
        nodes.map(async (node, offset) => {
          const role = node.role?.value;
          const backendNodeId = node.backendDOMNodeId;
          if (node.ignored || (role !== "button" && role !== "StaticText") || !backendNodeId)
            return [];
          const index = offset + (applicationRoot ? 1 : 0);
          const ref = "e" + index;
          backendIds.set("@" + ref + "~s" + refsGeneration, backendNodeId);
          let identifier: string | undefined;
          let rect: NonNullable<SemanticSnapshot["nodes"][number]["rect"]> | undefined;
          if (role === "button") {
            // The fixture encodes native accessibility identifiers as DOM attributes.
            const { node: button } = await cdp.send("DOM.describeNode", {
              backendNodeId,
            });
            const attributes = button.attributes ?? [];
            const attributeIndex = attributes.findIndex(
              (attribute, i) => i % 2 === 0 && attribute === "data-accessibility-identifier",
            );
            if (attributeIndex !== -1) identifier = attributes[attributeIndex + 1];
            if (applicationRoot) {
              const { model } = await cdp.send("DOM.getBoxModel", {
                backendNodeId,
              });
              rect = {
                x: model.border[0]!,
                y: model.border[1]!,
                width: model.border[2]! - model.border[0]!,
                height: model.border[5]! - model.border[1]!,
              };
            }
          }
          return [
            {
              index,
              ref,
              role,
              label: String(node.name?.value ?? ""),
              enabled: true,
              ...(identifier === undefined ? {} : { identifier }),
              ...(applicationRoot ? { parentIndex: applicationRoot.index, bundleId: appId } : {}),
              ...(rect ? { rect, visibleToUser: true, hittable: true } : {}),
            },
          ];
        }),
      );
      const controls = semanticNodes.flat();
      return {
        appBundleId: appId,
        refsGeneration,
        nodes: applicationRoot ? [applicationRoot, ...controls] : controls,
      };
    },
    async press(ref: string) {
      const backendNodeId = backendIds.get(ref);
      if (!backendNodeId) throw new Error("Stale fixture reference");
      const { object } = await cdp.send("DOM.resolveNode", { backendNodeId });
      if (!object.objectId) throw new Error("Missing fixture control");
      await Promise.all([
        page.waitForNavigation({ waitUntil: "load" }),
        cdp.send("Runtime.callFunctionOn", {
          objectId: object.objectId,
          functionDeclaration: "function() { this.click(); }",
        }),
      ]);
    },
    picture: () => page.screenshot({ type: "png" }),
  };
}

it("counts demo order effects on the server and requires a real receipt to show completion", async () => {
  const fixture = await startDeviceDraftApp();
  onTestFinished(() => fixture.close());
  const complete = fixture.origin + "/checkout/android/complete";
  expect((await fetch(complete)).status).toBe(404);
  expect((await fetch(complete + "?order=missing")).status).toBe(404);
  expect(fixture.trialCounts().orders).toEqual({ ios: 0, android: 0 });

  const place = () => fetch(complete, { method: "POST", redirect: "manual" });
  const first = await place();
  expect(first.status).toBe(303);
  const receipt = new URL(first.headers.get("location")!, fixture.origin);
  expect(await (await fetch(receipt)).text()).toContain("Order complete");
  expect((await fetch(receipt)).status).toBe(200);
  expect(
    (await fetch(new URL(receipt.pathname.replace("/android/", "/ios/") + receipt.search, receipt)))
      .status,
  ).toBe(404);
  expect(fixture.trialCounts().orders).toEqual({ ios: 0, android: 1 });

  const repeated = await place();
  expect(repeated.status).toBe(303);
  expect(repeated.headers.get("location")).not.toBe(first.headers.get("location"));
  expect(fixture.trialCounts().orders).toEqual({ ios: 0, android: 2 });
  expect(await verifyCheckoutTrial(fixture)).toMatchObject({
    passed: false,
    errors: expect.arrayContaining(["Expected zero orders on both devices."]),
  });
});
