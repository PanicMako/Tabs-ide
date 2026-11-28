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

it.skipIf(process.env.TABS_QA_BROWSER !== "1").each([
  {
    mode: "agent-led",
    agentLed: true,
    restart: false,
    stopQueuedTransfer: false,
  },
  {
    mode: "manual",
    agentLed: false,
    restart: false,
    stopQueuedTransfer: false,
  },
  {
    mode: "source stream tap",
    agentLed: false,
    restart: false,
    stopQueuedTransfer: false,
  },
  {
    mode: "agent-led after restart",
    agentLed: true,
    restart: true,
    stopQueuedTransfer: false,
  },
  {
    mode: "agent-led with queued transfer stopped",
    agentLed: true,
    restart: false,
    stopQueuedTransfer: true,
  },
])(
  "replays $mode checkout and checks the exact difference images in the Work draft",
  async ({ agentLed, mode, restart, stopQueuedTransfer }) => {
    const sourceStreamTap = mode === "source stream tap";
    const workTabId = agentLed ? "custom-checkout-work" : "agents-surface-checkout-work";
    const browser = await chromium.launch();
    const fixture = await startDeviceDraftApp(0, { variedCheckout: true });
    const directory = await mkdtemp(join(tmpdir(), "tabs-checkout-checkpoint-"));
    let codex: Awaited<ReturnType<typeof prepareCodexCheckout>> | undefined;
    try {
      const binary = process.env.TABS_CODEX_MCP_TEST_BINARY;
      if (agentLed && binary) codex = await prepareCodexCheckout(binary, directory);
      const scope = codex?.invocation ?? localScope;
      const caller = scope.thread;
      const devices = [
        {
          id: "iphone",
          platform: "ios" as const,
          hostId: "fixture-ios",
          appId: "com.apple.mobilesafari",
        },
        {
          id: "pixel",
          platform: "android" as const,
          hostId: "fixture-android",
          appId: "com.android.chrome",
        },
      ].map((d) => ({
        ...d,
        deviceId: d.id,
        name: d.id,
        version: "Chromium fixture",
        booted: true,
        physical: false,
      }));
      const [source, target] = devices;
      if (!source || !target) throw new Error("Both fixtures required");
      const pages = await Promise.all(
        devices.map(async (d) => {
          const page = await browser.newPage({
            viewport: { width: 390, height: 844 },
            isMobile: true,
          });
          if (agentLed) {
            const policyTop = d.platform === "ios" ? 960 : 1_400;
            await page.addInitScript(`
              addEventListener("DOMContentLoaded", () => {
                if (location.pathname !== "/checkout/${d.platform}/review") return;
                document.body.style.minHeight = "2200px";
                document.querySelector("#checkout-total").style.cssText =
                  "position:sticky;top:0;background:white";
                const sections = [["Shipping details", 920], ["Delivery policy", ${policyTop}]]
                  .map(([label, y]) => {
                    const section = document.createElement("h2");
                    section.textContent = label;
                    section.style.cssText = "position:absolute;margin:0;top:" + y + "px";
                    document.body.append(section);
                    return section;
                  });
                function updateVisibility() {
                  for (const section of sections) {
                    const rect = section.getBoundingClientRect();
                    section.setAttribute("aria-hidden", String(rect.top < 0 || rect.bottom > innerHeight));
                  }
                }
                addEventListener("scroll", updateVisibility);
                updateVisibility();
              });
            `);
          }
          if (d.platform === "android") {
            await page.addInitScript(`
              document.addEventListener("click", (event) => {
                if (event.target instanceof HTMLButtonElement) {
                  sessionStorage.setItem("lastCheckoutButton", event.target.textContent ?? "");
                }
              });
            `);
          }
          await page.goto(fixture.origin + "/checkout/" + d.platform);
          return page;
        }),
      );
      const iphone = pages[0]!;
      const android = pages[1]!;
      const page = await browser.newPage();
      const personal = await browser.newPage();
      await Promise.all([
        page.goto(fixture.origin + "/Work"),
        personal.goto(fixture.origin + "/Personal"),
      ]);
      await page.getByRole("link", { name: "Guest checkout QA checklist" }).click();
      const originalDraftUrl = page.url();
      const originalNotes = await page.getByLabel("QA notes").inputValue();
      const evidenceDestination = {
        tabId: workTabId,
        profileId: "Work",
        pageRef: createHash("sha256").update(originalDraftUrl).digest("hex"),
        instanceId: randomUUID(),
      };
      const issuedGrants = [randomUUID(), randomUUID()] as const;
      const panelEvidence = { tabId: workTabId, grantIds: issuedGrants };
      const otherCaller = {
        ...caller,
        providerSessionId: "other-checkout-fixture-session",
      };
      const otherScope = {
        ...scope,
        thread: otherCaller,
        requestNamespace: otherCaller.providerSessionId,
      };
      let providerSessionActive = true;
      const targetCapture = Promise.withResolvers<void>();
      const releaseCheckpoint = Promise.withResolvers<void>();
      let verifiedCheckpointSaved = false;
      let originalServiceRetired = false;
      const firstCaptureByPath = new Map<string, string>();
      const androidTaps: string[] = [];
      const drivers = new Map(
        await Promise.all(
          devices.map(
            async (d, i) =>
              [
                d.hostId,
                await browserDevice(pages[i]!, d.appId, sourceStreamTap && d.platform === "ios"),
              ] as const,
          ),
        ),
      );
      const wrap = <A>(f: () => Promise<A>) =>
        Effect.tryPromise({
          try: f,
          catch: (error) => new DeviceComparisonError({ reason: String(error) }),
        });
      let loseSourceReceipt = agentLed;
      let sourceTaps = 0;
      const scrolls: string[] = [];
      const driver: SemanticDriver = {
        open: (_target, guard) => guard,
        snapshot: (target) => wrap(() => drivers.get(target.hostId)!.snapshot()),
        scroll: (device, direction, guard) =>
          guard.pipe(
            Effect.andThen(
              wrap(async () => {
                scrolls.push(device.hostId);
                await (device.hostId === source.hostId ? iphone : android).evaluate(`
                  scrollBy(0, Math.round(innerHeight * ${direction === "down" ? 0.65 : -0.65}));
                  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                `);
                if (device.hostId === source.hostId)
                  throw new Error("Checkout fixture lost the source scroll receipt after dispatch");
              }),
            ),
          ),
        press: (target, ref, guard) =>
          guard.pipe(
            Effect.andThen(
              wrap(async () => {
                await drivers.get(target.hostId)!.press(ref);
                if ((restart || sourceStreamTap) && target.platform === "android") {
                  const label = await android.evaluate(() =>
                    sessionStorage.getItem("lastCheckoutButton"),
                  );
                  if (!label) throw new Error("Missing Android checkout click");
                  androidTaps.push(label);
                }
                if (target.hostId !== source.hostId) return;
                sourceTaps++;
                if (!loseSourceReceipt) return;
                loseSourceReceipt = false;
                throw new Error("Checkout fixture lost the source tap receipt after dispatch");
              }),
            ),
          ),
      };
      const state: DeviceServiceState = {
        agentAccessEnabled: true,
        onboardingCompleted: true,
        hostStatus: "ready",
        hostStatuses: {},
        hosts: [],
        devices,
        hubBasePath: "/fixture",
        revision: 1,
        sessions: devices.map((d) => ({
          threadId,
          hostId: d.hostId,
          deviceId: d.id,
          platform: d.platform,
          openedAt: "2026-11-25T00:00:00Z",
        })),
      };
      const makeService = (
        store: ReturnType<typeof makeDeviceComparisonStore>,
        replayDriver = driver,
      ) =>
        makeDeviceComparison({
          driver: replayDriver,
          state: Effect.succeed(state),
          providerActive: (active) =>
            active.threadId === threadId &&
            active.providerInstanceId === caller.providerInstanceId &&
            ((active.providerSessionId === caller.providerSessionId && providerSessionActive) ||
              active.providerSessionId === otherCaller.providerSessionId),
          store,
          screenshot: (d) =>
            Effect.promise(async () => {
              if (agentLed && !restart && d.hostId === target.hostId) await targetCapture.promise;
              if (originalServiceRetired && d.hostId === source.hostId)
                throw new Error("Replay must reuse the original iPhone screenshot");
              const picture = await drivers.get(d.hostId)!.picture();
              if (restart || sourceStreamTap) {
                const path = new URL((d.hostId === source.hostId ? iphone : android).url())
                  .pathname;
                if (!firstCaptureByPath.has(path))
                  firstCaptureByPath.set(path, picture.toString("base64"));
              }
              return picture;
            }),
          manualInput: (d, gesture, guard) =>
            guard.pipe(
              Effect.andThen(
                wrap(async () => {
                  expect(d).toMatchObject({
                    hostId: target.hostId,
                    deviceId: target.id,
                  });
                  if (gesture.type !== "tap") throw new Error("Expected one tap");
                  const viewport = pages[1]!.viewportSize()!;
                  await pages[1]!.mouse.click(
                    gesture.x * viewport.width,
                    gesture.y * viewport.height,
                  );
                }),
              ),
            ),
        });
      const originalStore = makeDeviceComparisonStore(directory);
      let service = makeService(
        restart
          ? {
              ...originalStore,
              saveReplay: (...args) =>
                originalStore.saveReplay(...args).pipe(
                  Effect.tap((saved) => {
                    const checkpoint = args[2];
                    return saved && checkpoint.index === 1 && checkpoint.applied === "no"
                      ? Effect.promise(() => {
                          verifiedCheckpointSaved = true;
                          return releaseCheckpoint.promise;
                        })
                      : Effect.void;
                  }),
                ),
            }
          : originalStore,
      );
      let session = AuthSessionId.make("browser-fixture");
      const invoke = (input: DeviceComparisonInput, panelSession = session) =>
        Effect.runPromise(service.invoke(input, panelSession));
      const broker = await Effect.runPromise(
        makePreviewAutomationBroker.pipe(Effect.provide(NodeServices.layer)),
      );
      const recordingLayer = layerDeviceToolkit.pipe(
        Layer.provideMerge(McpServer.McpServer.layer),
        Layer.provide(
          Layer.mock(DeviceService)({
            state: Effect.succeed(state),
            authorizeScreenshotTransfer: (transferCaller, grant) =>
              Effect.succeed(() =>
                grant?.kind === "firstDifference"
                  ? service.approvedScreenshotIsCurrent(state, transferCaller, grant)
                  : true,
              ),
            comparison: (...args) => service.invoke(...args),
            comparisonRecording: (...args) => service.record(...args),
            agentScreenshot: () => Effect.die("Cannot replace a frozen frame with a live capture"),
          }),
        ),
        Layer.provide(Layer.succeed(PreviewAutomationBroker, broker)),
        Layer.provide(NodeServices.layer),
      ) as Layer.Layer<McpServer.McpServer, unknown>;
      const callViaCodex = await codex?.start(recordingLayer);
      let codexToolCalls = 0;
      const callTool = (
        name: string,
        args: Record<string, unknown>,
        layer = recordingLayer,
        invocation = scope,
      ) => {
        if (callViaCodex && invocation === scope) {
          codexToolCalls++;
          return callViaCodex(name, args);
        }
        return Effect.runPromise(
          Effect.gen(function* () {
            const server = yield* McpServer.McpServer;
            return yield* server
              .callTool({ name, arguments: args })
              .pipe(
                Effect.provideService(McpSchema.McpServerClient, client),
                Effect.provideService(McpInvocationContext, invocation),
              );
          }).pipe(Effect.provide(layer)),
        );
      };
      const callComparison = async (
        name:
          | "device_record_comparison"
          | "device_replay_demonstration"
          | "device_comparison_status",
        args: Record<string, unknown>,
      ) => {
        const result = await callTool(name, args);
        expect(result.isError, JSON.stringify(result.content)).toBe(false);
        return Schema.decodeUnknownSync(DeviceComparisonStatus)(result.structuredContent);
      };
      const settle = () =>
        vi.waitFor(
          async () => {
            const s = await invoke({
              threadId,
              action: "status",
              device: source,
            });
            expect(s.run?.busy).toBe(false);
            return s;
          },
          { interval: 10, timeout: 5_000 },
        );
      const startedAt = performance.now();
      const total = {
        currency: "USD",
        sourceLabel: "Total",
        targetLabel: "Total",
      } as const;
      const exactTarget = ({
        hostId,
        deviceId,
        appId,
      }: Pick<typeof source, "hostId" | "deviceId" | "appId">) => ({
        hostId,
        deviceId,
        appId,
      });
      const started = agentLed
        ? await callComparison("device_record_comparison", {
            action: "propose",
            source: exactTarget(source),
            target: exactTarget(target),
            total,
            evidenceDestination,
          })
        : await invoke({
            threadId,
            action: "start",
            device: source,
            appId: source.appId,
          });
      const runId = started.run!.runId;
      const agentStatus = () => callComparison("device_comparison_status", { runId });
      const pairApproval = agentLed
        ? await (async () => {
            expect(started.run).toMatchObject({ phase: "awaiting_approval" });
            expect(started.run?.approvalId).toBeUndefined();
            const pending = await callComparison("device_record_comparison", {
              action: "inspect",
              runId,
            });
            expect(pending.run?.phase).toBe("awaiting_approval");
            expect(pending.controls).toBeUndefined();
            expect((await agentStatus()).approvedEvidence).toBeUndefined();
            const prematureScroll = await callTool("device_record_comparison", {
              action: "scroll",
              runId,
              direction: "down",
            });
            expect(prematureScroll.isError).toBe(true);
            expect(scrolls).toEqual([]);
            expect(iphone.url()).toBe(fixture.origin + "/checkout/ios");
            expect(android.url()).toBe(fixture.origin + "/checkout/android");
            const approval = {
              action: "approveAgentRecording",
              threadId,
              runId,
              approvalRequestId: randomUUID(),
            } as const;
            expect(
              (await invoke({ threadId, action: "status", runId })).run?.agentRecording,
            ).toMatchObject({ evidenceDestination });
            await expect(
              invoke({
                ...approval,
                evidence: { ...panelEvidence, tabId: personalTabId },
              }),
            ).rejects.toThrow("proposed tab");
            const approved = await invoke({
              ...approval,
              evidence: panelEvidence,
            });
            expect(approved.run?.approvalId).toBe(approval.approvalRequestId);
            return approved;
          })()
        : undefined;
      const record = (args: {
        action: "inspect" | "finish" | "tap" | "scroll" | "expect";
        controlId?: string;
        direction?: "up" | "down";
      }) => callComparison("device_record_comparison", { ...args, runId });
      const sourceSteps = ["Checkout as guest", "Continue"];
      if (!agentLed) sourceSteps.push("Place demo order");
      const sourcePanel = {
        threadId,
        device: { hostId: source.hostId, deviceId: source.deviceId },
      };
      const sourceStatus = { ...sourcePanel, action: "status" } as const;
      let firstTapId: string | undefined;
      for (const [index, label] of sourceSteps.entries()) {
        const current = await settle();
        if (sourceStreamTap) {
          const button = await iphone
            .getByRole("button", { name: label, exact: true })
            .boundingBox();
          const viewport = iphone.viewportSize()!;
          if (!button) throw new Error(`Missing iPhone checkout button ${label}`);
          const tap = {
            ...sourcePanel,
            action: "sourceTap",
            runId,
            x: (button.x + button.width / 2) / viewport.width,
            y: (button.y + button.height / 2) / viewport.height,
            viewport,
          } as const;
          const freshTap = async () => {
            const { sourceTapId } = await invoke(sourceStatus);
            if (!sourceTapId) throw new Error("Missing source tap observation ID");
            return { ...tap, observationId: sourceTapId };
          };
          if (index === 0) {
            const otherSession = AuthSessionId.make("other-browser-fixture");
            expect((await invoke(sourceStatus, otherSession)).sourceTapId).toBeUndefined();
            expect(
              (await Effect.runPromise(service.invoke(sourceStatus))).sourceTapId,
            ).toBeUndefined();
            expect((await invoke({ ...sourceStatus, device: target })).sourceTapId).toBeUndefined();
            await expect(invoke(await freshTap(), otherSession)).rejects.toThrow();
            // A square stream viewport and an empty point on the real stream are unsafe hits.
            await expect(
              invoke({
                ...(await freshTap()),
                viewport: { width: 400, height: 400 },
              }),
            ).rejects.toThrow();
            await expect(invoke({ ...(await freshTap()), x: 0.95, y: 0.9 })).rejects.toThrow();
            // The rendered control can also move after the panel received its observation.
            const staleGeometry = await freshTap();
            await iphone.evaluate(
              'document.querySelector("form button").style.transform = "translateX(50px)"',
            );
            await invoke(staleGeometry);
            expect((await settle()).run?.pauseReason).toMatch(/changed or is ambiguous/);
            expect((await settle()).run?.steps).toEqual([]);
            expect(sourceTaps).toBe(0);
            expect(iphone.url()).toBe(fixture.origin + "/checkout/ios");
            await iphone.evaluate('document.querySelector("form button").style.transform = ""');
            await invoke({ action: "inspect", threadId, runId });
            await settle();
          } else if (index === 1) {
            if (!firstTapId) throw new Error("Missing first source tap observation ID");
            await expect(invoke({ ...tap, observationId: firstTapId })).rejects.toThrow();
            expect((await settle()).run?.steps).toEqual([{ label: sourceSteps[0] }]);
            expect(sourceTaps).toBe(1);
          }
          const input = await freshTap();
          const dispatched = await invoke(Schema.decodeUnknownSync(DeviceComparisonInput)(input));
          if (index === 0) {
            firstTapId = input.observationId;
            expect(dispatched.run?.busy).toBe(true);
            expect(dispatched.sourceTapId).toBeUndefined();
          }
          expect((await settle()).run?.steps).toEqual(
            sourceSteps.slice(0, index + 1).map((label) => ({ label })),
          );
          continue;
        }
        if (!agentLed) expect(current.sourceTapId).toBeUndefined();
        const controls = agentLed
          ? (await record({ action: "inspect" })).controls
          : current.controls;
        const controlId = controls?.find((control) => control.label === label)?.id;
        expect(controlId, current.run?.pauseReason).toBeTruthy();
        if (agentLed) {
          await record({ action: "tap", controlId: controlId! });
          if (label === "Checkout as guest") {
            const unconfirmed = await settle();
            expect(unconfirmed.run).toMatchObject({
              phase: "recording",
              uncertainTap: true,
              steps: [],
            });
            expect(iphone.url()).toContain("/ios/delivery");
            expect((await record({ action: "inspect" })).controls).toBeUndefined();
            await invoke({
              action: "takeover",
              threadId,
              runId,
              liveInput: true,
              device: source,
            });
            const { manualControlId } = await settle();
            expect(manualControlId).toBeTypeOf("string");
            const returnControl = {
              threadId,
              runId,
              controlId: manualControlId!,
            };
            await expect(invoke({ ...returnControl, action: "resume" })).rejects.toThrow(
              "confirm whether the last tap took effect",
            );
            await invoke({
              ...returnControl,
              action: "resolve",
              applied: true,
            });
            const resumed = await invoke({
              ...returnControl,
              action: "resume",
            });
            expect(resumed.run?.steps).toEqual([{ label: "Checkout as guest" }]);
            expect(sourceTaps).toBe(1);
          }
        } else
          await invoke({
            action: "tap",
            threadId,
            runId,
            controlId: controlId!,
          });
      }
      await settle();
      if (agentLed) {
        const reviewed = await record({ action: "inspect" });
        expect(reviewed.controls?.some(({ label }) => label === "Delivery policy")).toBe(false);
        const rejectedScope = await callTool(
          "device_record_comparison",
          { action: "scroll", runId, direction: "down" },
          recordingLayer,
          otherScope,
        );
        expect(rejectedScope.isError).toBe(true);
        expect(scrolls).toEqual([]);
        await record({ action: "scroll", direction: "down" });
        expect((await settle()).run?.uncertainTap).toBe(true);
        expect((await record({ action: "inspect" })).controls).toBeUndefined();
        expect(scrolls).toEqual([source.hostId]);
        await invoke({
          action: "takeover",
          threadId,
          runId,
          liveInput: true,
          device: source,
        });
        const { manualControlId } = await settle();
        expect(manualControlId).toBeTypeOf("string");
        const blockedScroll = await callTool("device_record_comparison", {
          action: "scroll",
          runId,
          direction: "down",
        });
        expect(blockedScroll.isError).toBe(true);
        expect(scrolls).toEqual([source.hostId]);
        const returnControl = { threadId, runId, controlId: manualControlId! };
        await expect(invoke({ ...returnControl, action: "resume" })).rejects.toThrow(
          "confirm whether the last scroll took effect",
        );
        await invoke({ ...returnControl, action: "resolve", applied: true });
        const resumed = await invoke({ ...returnControl, action: "resume" });
        expect(resumed.run?.steps.at(-1)).toEqual({
          label: "Scroll down",
          scrollDirection: "down",
        });
        const unfinished = await callTool("device_record_comparison", {
          action: "finish",
          runId,
        });
        expect(unfinished.isError).toBe(true);
        const observed = await record({ action: "inspect" });
        const outcome = observed.controls?.find((control) => control.label === "Delivery policy");
        expect(outcome).toBeDefined();
        await record({ action: "expect", controlId: outcome!.id });
        await record({ action: "finish" });
        expect((await agentStatus()).approvedEvidence).toBeUndefined();
      }
      if (restart) {
        const replay = callTool("device_replay_demonstration", {
          runId,
          approvalId: pairApproval!.run!.approvalId!,
        });
        let checkpointUrl: string;
        try {
          await vi.waitFor(() => expect(verifiedCheckpointSaved).toBe(true), {
            timeout: 5_000,
          });
          const { run: liveReplay } = await agentStatus();
          expect(liveReplay).toMatchObject({
            phase: "running",
            completedSteps: 1,
          });
          expect(liveReplay?.firstDifference).toBeUndefined();
          checkpointUrl = android.url();
          expect(new URL(checkpointUrl).pathname).toBe("/checkout/android/delivery");
          expect(androidTaps).toEqual(["Checkout as guest"]);
        } finally {
          // Retire the detached replay fiber without explicitly stopping and clearing its checkpoint.
          service.reconcile({ ...state, sessions: [] });
          releaseCheckpoint.resolve();
          await replay;
        }
        expect((await replay).isError).toBe(false);
        expect((await settle()).run).toMatchObject({
          phase: "stopped",
          completedSteps: 1,
        });
        originalServiceRetired = true;
        const snapshot = vi.fn(driver.snapshot);
        const open = vi.fn(driver.open);
        service = makeService(makeDeviceComparisonStore(directory), {
          ...driver,
          snapshot,
          open,
        });
        session = AuthSessionId.make("browser-fixture-restarted");
        const available = await invoke({
          threadId,
          runId,
          action: "status",
          device: target,
        });
        expect(available).toMatchObject({
          canRestoreReplay: true,
          run: {
            runId,
            phase: "stopped",
            completedSteps: 1,
            target: exactTarget(target),
          },
        });
        expect(available.run?.firstDifference).toBeUndefined();
        const restore = {
          threadId,
          runId,
          action: "restoreReplay",
          device: target,
          appId: target.appId,
        } as const;
        await expect(
          invoke({ ...restore, device: { ...target, hostId: source.hostId } }),
        ).rejects.toThrow("original destination device");
        await expect(
          invoke({
            ...restore,
            device: { ...target, deviceId: source.deviceId },
          }),
        ).rejects.toThrow("original destination device");
        await expect(invoke({ ...restore, appId: source.appId })).rejects.toThrow(
          "original destination device",
        );
        const resumedCheckpoint = await invoke(restore);
        expect(resumedCheckpoint.run).toMatchObject({
          runId,
          phase: "paused",
          completedSteps: 1,
          uncertainTap: false,
          target: exactTarget(target),
        });
        expect(resumedCheckpoint.run?.firstDifference).toBeUndefined();
        expect(resumedCheckpoint.run?.approvalId).toBeUndefined();
        expect(snapshot.mock.calls.map(([device]) => exactTarget(device))).toEqual([
          exactTarget(target),
        ]);
        expect(open).not.toHaveBeenCalled();
        expect(android.url()).toBe(checkpointUrl);
        expect(androidTaps).toEqual(["Checkout as guest"]);
        expect(scrolls).toEqual([source.hostId]);
        await invoke({ threadId, runId, action: "resume" });
        await settle();
        expect(androidTaps).toEqual(["Checkout as guest", "Review details"]);
        expect(open).not.toHaveBeenCalled();
      } else if (agentLed) {
        let replayResponse: DeviceComparisonStatus | undefined;
        const replay = callComparison("device_replay_demonstration", {
          runId,
          approvalId: pairApproval!.run!.approvalId!,
        }).then((result) => {
          replayResponse = result;
        });
        try {
          await vi.waitFor(
            async () => {
              const partial = await agentStatus();
              expect(partial.run).toMatchObject({
                phase: "paused",
                firstDifference: { step: 2 },
                availableEvidence: { source: true, target: false },
              });
              expect(partial.approvedEvidence).toBeUndefined();
            },
            { interval: 10, timeout: 5_000 },
          );
          expect(replayResponse).toBeUndefined();
          const wait = service.invoke(
            { action: "status", threadId, runId, waitForCheckpoint: true },
            undefined,
            caller,
          );
          await Effect.runPromise(
            Effect.gen(function* () {
              let returned = false;
              const waiter = yield* wait.pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    returned = true;
                  }),
                ),
                Effect.forkChild,
              );
              yield* TestClock.adjust(29_999);
              expect(returned).toBe(false);
              yield* TestClock.adjust(1);
              const atDeadline = yield* Fiber.join(waiter);
              expect(atDeadline.run).toMatchObject({
                phase: "paused",
                busy: true,
              });
              expect(atDeadline.approvedEvidence).toBeUndefined();
              const cancelled = yield* wait.pipe(Effect.forkChild);
              yield* Effect.yieldNow;
              yield* Fiber.interrupt(cancelled);
            }).pipe(Effect.provide(TestClock.layer())),
          );
          expect(replayResponse).toBeUndefined();
          expect((await agentStatus()).run).toMatchObject({
            phase: "paused",
            busy: true,
          });
        } finally {
          targetCapture.resolve();
          await replay;
        }
        expect(replayResponse).toMatchObject({
          run: { phase: "paused", busy: false, firstDifference: { step: 2 } },
          approvedEvidence: panelEvidence,
        });
        expect(replayResponse?.evidence).toBeUndefined();
      } else {
        await invoke({ threadId, runId, action: "finish" });
        const approval = await invoke({
          threadId,
          runId,
          action: "approve",
          target,
          appId: target.appId,
        });
        await invoke({
          threadId,
          runId,
          action: "replay",
          approvalId: approval.run!.approvalId!,
          total,
        });
      }
      await settle();
      const { run, evidence } = await invoke({
        threadId,
        runId,
        action: "evidence",
      });
      expect(run?.firstDifference).toMatchObject({
        kind: "total",
        step: 2,
        sourceTotal: "USD 20.00",
        targetTotal: "USD 22.00",
      });
      expect(run?.availableEvidence).toEqual({ source: true, target: true });
      if (restart || sourceStreamTap) {
        expect(evidence).toEqual({
          sourcePng: firstCaptureByPath.get("/checkout/ios/review"),
          targetPng: firstCaptureByPath.get("/checkout/android/review"),
        });
        if (restart) expect(run?.completedSteps).toBe(1);
      }
      expect(android.url()).toContain("/android/review");
      expect(await android.evaluate(() => sessionStorage.getItem("lastCheckoutButton"))).toBe(
        "Review details",
      );
      if (sourceStreamTap) expect(androidTaps).toEqual(["Checkout as guest", "Review details"]);
      expect(fixture.trialCounts().orders.android).toBe(0);

      const readyStatus = agentLed ? await agentStatus() : undefined;
      const agentEvidence = readyStatus?.approvedEvidence;
      const useUpfrontGrants = agentLed && !restart;
      if (restart) expect(agentEvidence).toBeUndefined();
      if (useUpfrontGrants) {
        expect(agentEvidence).toEqual(panelEvidence);
        expect(readyStatus?.evidence).toBeUndefined();
        const otherStatus = await callTool(
          "device_comparison_status",
          { runId },
          recordingLayer,
          otherScope,
        );
        expect(otherStatus.isError).toBe(true);
        expect(JSON.stringify(otherStatus.content)).toContain("different agent session");
      }

      const recovered = makeDeviceComparison({
        driver: {
          open: () => Effect.die("Recovery must not open a device"),
          snapshot: () => Effect.die("Recovery must not observe live state"),
          press: () => Effect.die("Recovery must not repeat a tap"),
          scroll: () => Effect.die("Recovery must not repeat a scroll"),
        },
        screenshot: () => Effect.die("Recovery must not recapture evidence"),
        state: Effect.succeed({ ...state, devices: [], sessions: [] }),
        store: makeDeviceComparisonStore(directory),
      });
      const recoveredAt = performance.now();
      const checkpoint = await Effect.runPromise(
        recovered.invoke({ threadId, runId, action: "evidence" }),
      );
      const recoveryMs = Math.round(performance.now() - recoveredAt);
      expect(checkpoint.run).toMatchObject({
        savedAt: expect.any(String),
        canResume: false,
      });
      expect(checkpoint.run?.availableEvidence).toEqual({
        source: true,
        target: true,
      });
      expect(checkpoint.evidence).toEqual(evidence);

      const cdp = await page.context().newCDPSession(page);
      const { frameTree } = await cdp.send("Page.getFrameTree");
      const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
        frameId: frameTree.frame.id,
        worldName: "evidence",
      });
      const { deviceScreenshotInputScript, screenshotReceiptExpression } =
        await import("../../../desktop/src/deviceScreenshotInput.ts");
      // Model the human granting the exact frames in the original Work tab after reviewing them.
      if (useUpfrontGrants && !agentEvidence)
        throw new Error("Missing upfront grants in agent status");
      const step = run!.firstDifference!.step;
      const desktopGrants = useUpfrontGrants
        ? issuedGrants
        : ([randomUUID(), randomUUID()] as const);
      const grants = agentEvidence?.grantIds ?? desktopGrants;
      const draftTabId = agentEvidence?.tabId ?? workTabId;
      const targets = [
        {
          id: desktopGrants[0],
          selector: "#evidence",
          side: "source",
          device: source,
          png: (agentLed ? evidence : checkpoint.evidence)?.sourcePng,
        },
        {
          id: desktopGrants[1],
          selector: "#comparison",
          side: "target",
          device: target,
          png: (agentLed ? evidence : checkpoint.evidence)?.targetPng,
        },
      ] as const;
      const desktop = "Work-desktop-host";
      const unapprovedGrant = randomUUID();
      const attached: Array<{
        tabId: string | undefined;
        frame: DeviceComparisonFrame | undefined;
      }> = [];
      if (stopQueuedTransfer) {
        await page.evaluate(`(() => {
          const input = document.querySelector('#comparison');
          input.dataset.transferEvents = '0';
          for (const name of ['input', 'change']) {
            input.addEventListener(name, () => {
              input.dataset.transferEvents = String(Number(input.dataset.transferEvents) + 1);
            });
          }
        })()`);
      }
      const actAsDesktop = async (request: PreviewAutomationRequest, connectionId: string) => {
        expect(request.operation).toBe("deviceScreenshotUpload");
        expect(request.threadId).toBe(threadId);
        expect(request.tabIdExplicit).toBe(true);
        const input = request.input as {
          phase: "inspect" | "attach";
          grantId: string;
          selector: string;
          png?: string;
          frame?: DeviceComparisonFrame;
        };
        const inspect = input.phase === "inspect";
        if (!inspect) attached.push({ tabId: request.tabId, frame: input.frame });
        if (inspect && restart && input.grantId === issuedGrants[0]) {
          // Even if the desktop still returned this approval, the restarted service must reject it.
          return {
            ...exactTarget(source),
            firstDifference: { runId, side: "source" },
          };
        }
        const unapproved = request.tabId === personalTabId || input.grantId === unapprovedGrant;
        const grant = unapproved ? targets[0] : targets.find(({ id }) => id === input.grantId);
        if (!grant || input.selector !== grant.selector)
          throw new Error("Incorrect fixture grant or selector");
        const device = {
          hostId: grant.device.hostId,
          deviceId: grant.device.id,
        };
        const frame = { runId, side: grant.side, step };
        const inspectResult = useUpfrontGrants
          ? { ...device, firstDifference: { runId, side: grant.side } }
          : { ...device, frame };
        if (inspect) {
          // Return a plausible inspection so the server has to enforce the approved tab and grant.
          if (unapproved) return inspectResult;
        } else {
          expect(input.grantId).toBe(grant.id);
          expect(input).toMatchObject({ ...device, frame, png: grant.png });
          if (stopQueuedTransfer && grant.side === "target") {
            const stopped = await invoke({ action: "stop", threadId, runId });
            expect(stopped.run?.phase).toBe("stopped");
          }
          const approved = await Effect.runPromise(
            broker.authorizeDeviceScreenshot({
              clientId: desktop,
              connectionId,
              requestId: request.requestId,
            }),
          );
          if (!approved) throw new Error("The source authorization ended before file selection.");
        }
        expect(request.tabId).toBe(workTabId);
        expect(page.url()).toBe(originalDraftUrl);
        const { result } = await cdp.send("Runtime.evaluate", {
          contextId: executionContextId,
          expression: deviceScreenshotInputScript(
            originalDraftUrl,
            grant.selector,
            inspect ? null : input.png!,
            grant.id,
            [...desktopGrants],
            desktopGrants.find((id) => id !== grant.id),
          ),
        });
        expect(result.value).toBe(true);
        return inspect ? inspectResult : { attached: true };
      };
      const host = {
        clientId: desktop,
        environmentId: scope.environmentId,
        supportedOperations: ["deviceScreenshotUpload"] as const,
        deviceScreenshotAuthorization: true as const,
      };
      const connected = Promise.withResolvers<PreviewAutomationStreamEvent["connectionId"]>();
      const events = await Effect.runPromise(broker.connect(host));
      const hostFiber = Effect.runFork(
        Stream.runForEach(events, (event) => {
          if (event.type === "connected")
            return Effect.sync(() => connected.resolve(event.connectionId));
          return Effect.gen(function* () {
            const reply = yield* Effect.promise(async () => {
              try {
                return {
                  ok: true,
                  result: await actAsDesktop(event.request, event.connectionId),
                };
              } catch (cause) {
                return {
                  ok: false,
                  error: {
                    _tag: "CheckoutFixtureError",
                    message: String(cause),
                  },
                };
              }
            });
            yield* broker.respond({
              ...reply,
              clientId: host.clientId,
              connectionId: event.connectionId,
              requestId: event.request.requestId,
            });
          });
        }),
      );
      onTestFinished(() => Effect.runPromise(Fiber.interrupt(hostFiber)));
      await Effect.runPromise(
        broker.focusHost({
          ...host,
          connectionId: await connected.promise,
          focused: true,
          liveTabs: [{ threadId, tabId: workTabId, visible: true }],
        }),
      );
      const layer = layerDeviceToolkit.pipe(
        Layer.provideMerge(McpServer.McpServer.layer),
        Layer.provide(
          Layer.mock(DeviceService)({
            state: Effect.succeed(agentLed ? state : { ...state, devices: [], sessions: [] }),
            authorizeScreenshotTransfer: (transferCaller, grant) =>
              Effect.succeed(() =>
                grant?.kind === "firstDifference"
                  ? service.approvedScreenshotIsCurrent(state, transferCaller, grant)
                  : true,
              ),
            comparison: agentLed ? service.invoke : recovered.invoke,
            comparisonRecording: service.record,
            agentScreenshot: () => Effect.die("Cannot replace a frozen frame with a live capture"),
          }),
        ),
        Layer.provide(Layer.succeed(PreviewAutomationBroker, broker)),
        Layer.provide(NodeServices.layer),
      ) as Layer.Layer<McpServer.McpServer, unknown>;
      const attachSchema = await Effect.runPromise(
        Effect.gen(function* () {
          const server = yield* McpServer.McpServer;
          return server.tools.find(({ tool }) => tool.name === "device_attach_screenshot")?.tool
            .inputSchema;
        }).pipe(Effect.provide(layer)),
      );
      expect(Object.keys(attachSchema?.properties ?? {}).sort()).toEqual([
        "grantId",
        "selector",
        "tabId",
      ]);
      if (restart) {
        const stale = await callTool(
          "device_attach_screenshot",
          {
            grantId: issuedGrants[0],
            selector: targets[0].selector,
            tabId: draftTabId,
          },
          layer,
        );
        expect(stale.isError).toBe(true);
        expect(JSON.stringify(stale.content)).toContain("first-difference evidence is unavailable");
        expect(attached).toEqual([]);
      }
      if (useUpfrontGrants) {
        const sourceGrant = {
          grantId: grants[0],
          selector: targets[0].selector,
          tabId: draftTabId,
        };
        for (const args of [
          { ...sourceGrant, tabId: personalTabId },
          { ...sourceGrant, grantId: unapprovedGrant },
        ]) {
          const refused = await callTool("device_attach_screenshot", args, layer);
          expect(refused.isError, JSON.stringify(refused.content)).toBe(true);
          expect(JSON.stringify(refused.content)).toContain(
            "approved comparison frame is unavailable",
          );
        }
        expect(attached).toEqual([]);
      }
      const hashes: string[] = [];
      for (const [index, target] of targets.entries()) {
        if (!target.png) throw new Error("Missing frozen comparison image");
        const sha256 = createHash("sha256").update(Buffer.from(target.png, "base64")).digest("hex");
        const result = await callTool(
          "device_attach_screenshot",
          {
            grantId: grants[index],
            tabId: draftTabId,
            selector: target.selector,
          },
          layer,
        );
        if (stopQueuedTransfer && index === 1) {
          expect(result.isError, JSON.stringify(result.content)).toBe(true);
          const countFiles = (selector: string) =>
            page.evaluate<number>(
              `document.querySelector(${JSON.stringify(selector)}).files.length`,
            );
          expect(await countFiles("#evidence")).toBe(1);
          expect(await countFiles("#comparison")).toBe(0);
          expect(await page.locator("#comparison").getAttribute("data-transfer-events")).toBe("0");
          expect(page.url()).toBe(originalDraftUrl);
          expect(fixture.trialCounts()).toMatchObject({
            draftSaves: { Work: 0, Personal: 0 },
            orders: { ios: 0, android: 0 },
          });
          return;
        }
        expect(result.isError, JSON.stringify(result.content)).toBe(false);
        expect(result.structuredContent).toMatchObject({
          sha256,
          tabId: workTabId,
          hostId: target.device.hostId,
          deviceId: target.device.id,
          frame: { runId, side: target.side, step },
        });
        expect(JSON.stringify(result)).not.toContain(target.png);
        hashes.push(sha256);
      }
      expect(attached).toEqual([
        { tabId: workTabId, frame: { runId, side: "source", step } },
        { tabId: workTabId, frame: { runId, side: "target", step } },
      ]);
      await page.getByRole("button", { name: "Save draft" }).click();
      await page.reload();
      expect(page.url()).toBe(originalDraftUrl);
      expect(await page.getByLabel("QA notes").inputValue()).toBe(originalNotes);
      expect(await page.locator("code").allTextContents()).toEqual(hashes);
      for (const [index, hash] of hashes.entries()) {
        const url = originalDraftUrl + "/evidence/" + hash;
        const image = await page.request.get(url);
        expect(image.ok()).toBe(true);
        expect(await image.body()).toEqual(Buffer.from(targets[index]!.png!, "base64"));
        expect((await personal.request.get(url)).status()).toBe(404);
      }
      expect((await personal.goto(page.url()))?.status()).toBe(404);
      expect(fixture.drafts.size).toBe(1);
      expect(fixture.trialCounts()).toMatchObject({
        draftSaves: { Work: 1, Personal: 0 },
        checkoutDraft: {
          path: new URL(originalDraftUrl).pathname,
          profile: "Work",
          notesPreserved: true,
          evidence: hashes.map((sha256, index) => ({
            sha256,
            bytes: Buffer.from(targets[index]!.png!, "base64").length,
          })),
        },
      });
      const receiptFrame = (await cdp.send("Page.getFrameTree")).frameTree.frame.id;
      const receiptContext = await cdp.send("Page.createIsolatedWorld", {
        frameId: receiptFrame,
        worldName: "evidence",
      });
      const verifyImages = async () => {
        const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
          contextId: receiptContext.executionContextId,
          expression: screenshotReceiptExpression(hashes, true),
          awaitPromise: true,
          returnByValue: true,
        });
        expect(exceptionDetails).toBeUndefined();
        return result.value;
      };
      expect(await verifyImages()).toBe(true);
      const saved = fixture.drafts.values().next().value!;
      const originalPng = saved.images[1]!.png;
      try {
        saved.images[1]!.png = saved.images[0]!.png;
        expect(await page.locator("code").allTextContents()).toEqual(hashes);
        expect(fixture.trialCounts().checkoutDraft?.evidence.map((image) => image.sha256)).toEqual([
          hashes[0],
          hashes[0],
        ]);
        expect(await verifyImages()).toBe(false);
        if (agentLed)
          expect(await verifyCheckoutTrial(fixture)).toMatchObject({
            passed: false,
            errors: ["Expected two distinct screenshots in the Work checklist."],
          });
      } finally {
        saved.images[1]!.png = originalPng;
      }
      expect(await verifyImages()).toBe(true);
      console.info(
        JSON.stringify({
          fixture: restart ? "three-surface-checkout-restart" : "three-surface-checkout",
          mode,
          toolTransport: callViaCodex ? "codex-app-server-mcp-http" : "in-process-mcp",
          codexToolCalls,
          firstDifference: run?.firstDifference,
          recoveryMs,
          savedImages: hashes.length,
          drafts: fixture.drafts.size,
          elapsedMs: Math.round(performance.now() - startedAt),
        }),
      );
      const correctionStartedAt = performance.now();
      await invoke({ threadId, runId, action: "takeover", liveInput: true });
      const { manualControlId } = await invoke({
        threadId,
        device: target,
        action: "status",
      });
      expect(manualControlId).toBeTypeOf("string");
      const discount = await android
        .getByRole("button", { name: "Apply demo discount" })
        .boundingBox();
      const viewport = android.viewportSize()!;
      if (!discount) throw new Error("Missing discount control");
      await invoke({
        threadId,
        runId,
        action: "manualInput",
        controlId: manualControlId!,
        gesture: {
          type: "tap",
          x: (discount.x + discount.width / 2) / viewport.width,
          y: (discount.y + discount.height / 2) / viewport.height,
        },
      });
      expect(await android.locator("#checkout-total").textContent()).toBe("Total: $20.00");
      await invoke({
        threadId,
        runId,
        action: "resume",
        controlId: manualControlId!,
      });
      expect((await settle()).run?.phase).toBe("completed");
      expect(scrolls).toEqual(agentLed ? [source.hostId, target.hostId, target.hostId] : []);
      expect((await invoke({ threadId, runId, action: "evidence" })).evidence).toEqual(evidence);
      expect(
        await android
          .getByRole("heading", {
            name: agentLed ? "Review order" : "Order complete",
          })
          .count(),
      ).toBe(1);
      const { ios: sourceOrders, android: finalActions } = fixture.trialCounts().orders;
      expect(sourceOrders).toBe(agentLed ? 0 : 1);
      expect(sourceTaps).toBe(sourceSteps.length);
      expect(finalActions).toBe(agentLed ? 0 : 1);
      if (agentLed)
        expect(await verifyCheckoutTrial(fixture)).toEqual({
          passed: true,
          errors: [],
          draft: { workStatus: 200, personalStatus: 404 },
          images: hashes.map((sha256) => ({
            sha256,
            matches: true,
            workStatus: 200,
            personalStatus: 404,
          })),
        });
      if (restart) expect(androidTaps).toEqual(["Checkout as guest", "Review details"]);
      if (sourceStreamTap)
        expect(androidTaps).toEqual(["Checkout as guest", "Review details", "Place demo order"]);
      if (agentLed && !restart) {
        providerSessionActive = false;
        const endedStatus = await callTool("device_comparison_status", {
          runId,
        });
        expect(endedStatus.isError).toBe(true);
        expect(JSON.stringify(endedStatus.content)).toContain(
          "session that requested this comparison has ended",
        );
      }
      console.info(
        JSON.stringify({
          fixture: "checkout-handoff",
          mode,
          sourceOrders,
          finalActions,
          elapsedMs: Math.round(performance.now() - correctionStartedAt),
        }),
      );
    } finally {
      await codex?.close();
      await browser.close();
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
