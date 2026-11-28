import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  PreviewTabId,
  ProjectId,
  RunId,
  ThreadId,
  type DeviceComparisonFrame,
  type DeviceComparisonReport,
} from "@tabs/contracts";
import * as CodexClient from "effect-codex-app-server/client";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { McpProtocol, McpServer } from "effect/unstable/ai";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { join } from "node:path";

import * as ServerConfig from "../../config.ts";
import { DeviceService } from "../../device/DeviceService.ts";
import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import * as McpHttpServer from "../../mcp/McpHttpServer.ts";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpSessionRegistry from "../../mcp/McpSessionRegistry.ts";
import { PreviewAutomationBroker } from "../../mcp/PreviewAutomationBroker.ts";
import { TerminalManager } from "../../terminal/Manager.ts";
import * as EffectWorker from "../EffectWorker.ts";
import * as IdAllocator from "../IdAllocator.ts";
import * as Orchestrator from "../Orchestrator.ts";
import { ProviderAdapterOpenSessionError } from "../ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "../ProviderAdapterRegistry.ts";
import { projectThreadProjectionForWire } from "../WireProjection.ts";
import * as ProviderReplayHarness from "../testkit/ProviderReplayHarness.ts";
import * as CodexAdapterV2 from "./CodexAdapterV2.ts";

// Opt in with a local Codex app-server binary. The model endpoint and home are disposable.
const binary = process.env.TABS_CODEX_MCP_TEST_BINARY;
const threadId = ThreadId.make("thread:codex-mcp-evidence");
const environmentId = EnvironmentId.make("environment:codex-mcp-evidence");
const projectId = ProjectId.make("project:codex-mcp-evidence");
const instanceId = CodexAdapterV2.CODEX_DEFAULT_INSTANCE_ID;
const modelSelection = { instanceId, model: "gpt-5.4" };
const approvalId = "c5c7e672-7dd1-4f7c-814e-f45ff73d89df";
const workTab = PreviewTabId.make("work-draft");
const grantId = "d73c703b-7e11-4857-8848-538fe29be608";
const approvedEvidence = {
  tabId: workTab,
  grantIds: [grantId, "acf55e20-4728-41f0-bb39-39d1c77a57b8"],
} as const;
const evidenceDestination = {
  tabId: workTab,
  profileId: "work",
  pageRef: "a".repeat(64),
  instanceId: "14b17281-718e-4b7a-9230-433d54d528b2",
};
const selector = "#evidence";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XHfQAAAAASUVORK5CYII=";
const digest = createHash("sha256").update(Buffer.from(png, "base64")).digest("hex");
const deviceRun: DeviceComparisonReport = {
  runId: RunId.make("4ca4ff32-a7fd-492b-bb33-90e883c94f51"),
  phase: "paused",
  source: {
    hostId: "local",
    deviceId: "fixture-simulator",
    platform: "ios",
    appId: "test.fixture",
    name: "Fixture Simulator",
  },
  target: {
    hostId: "android-host",
    deviceId: "fixture-simulator",
    appId: "test.android",
    name: "Fixture Pixel",
    platform: "android",
  },
  agentRecording: { manual: false, evidenceDestination },
  busy: false,
  playing: false,
  completedSteps: 1,
  steps: [{ label: "Read the checkout total" }],
  firstDifference: { step: 1, kind: "total", reason: "Fixture totals differ" },
  canResume: true,
  uncertainTap: false,
};
const frame: DeviceComparisonFrame = { runId: deviceRun.runId, side: "source", step: 1 };
const source = { hostId: deviceRun.source.hostId, deviceId: deviceRun.source.deviceId };
const proposalRunId = RunId.make("9933c918-5f83-478d-8467-615bd8b5c07a");
const proposal = {
  action: "propose",
  source: { ...source, appId: deviceRun.source.appId },
  target: { hostId: "android-host", deviceId: "fixture-simulator", appId: "test.android" },
  evidenceDestination,
} as const;
const recordingScroll = {
  action: "scroll",
  runId: RunId.make("3d5a7fa6-1bdb-4bb6-a870-85ffa8a428da"),
  direction: "down",
} as const;
const terminalRequestId = "890a6a1f-d885-46cf-a648-7e0653d85477";
const terminalProposal = {
  action: "propose",
  terminalId: "term-2",
  instanceId: "ecf7bbee-f0cd-47ad-89a9-ea0f83c4ced0",
  text: "printf 'approved fixture'",
  pressEnter: true,
} as const;
const toolCalls = [
  { name: "device_replay_demonstration", arguments: { runId: deviceRun.runId, approvalId } },
  { name: "device_attach_screenshot", arguments: { tabId: workTab, grantId, selector } },
  { name: "device_record_comparison", arguments: proposal },
  { name: "terminal_input", arguments: terminalProposal },
  { name: "device_record_comparison", arguments: recordingScroll },
  { name: "device_comparison_status", arguments: { runId: deviceRun.runId } },
];

function responsesFixture() {
  const requests: Array<{
    readonly tools?: ReadonlyArray<{
      readonly type: string;
      readonly name: string;
      readonly tools?: ReadonlyArray<{
        readonly name: string;
        readonly parameters?: { readonly type?: string };
      }>;
    }>;
    readonly input?: ReadonlyArray<{
      readonly type: string;
      readonly call_id?: string;
      readonly output?: unknown;
    }>;
  }> = [];
  const routes = HttpRouter.add("POST", "/v1/responses", (request) =>
    Effect.gen(function* () {
      const body = (yield* request.json) as (typeof requests)[number];
      const index = requests.push(body) - 1;
      const namespace = body.tools?.find((tool) => tool.name === "mcp__t3_code");
      const call = toolCalls[index];
      if (index > toolCalls.length || !namespace) {
        return HttpServerResponse.text("Unexpected fixture model request", { status: 400 });
      }
      const id = `fixture-response-${index}`;
      const item = call
        ? {
            type: "function_call",
            id: `tool-${index}`,
            call_id: `call-${index}`,
            namespace: namespace.name,
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          }
        : {
            type: "message",
            id: "fixture-answer",
            role: "assistant",
            content: [{ type: "output_text", text: "Fixture results verified.", annotations: [] }],
          };
      const frames = [
        { type: "response.created", response: { id } },
        { type: "response.output_item.added", output_index: 0, item },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: { id, output: [item] } },
      ];
      return HttpServerResponse.text(
        frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""),
        { contentType: "text/event-stream" },
      );
    }).pipe(Effect.orDie),
  );
  return { requests, routes };
}

it.live.skipIf(!binary)(
  "attaches frozen evidence and projects device and terminal approvals from Codex",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "tabs-codex-mcp-bridge-" });
      const layerConfig = ServerConfig.layerTest(directory, directory).pipe(
        Layer.provide(NodeServices.layer),
        Layer.orDie,
      );
      const config = yield* Layer.build(layerConfig);
      const http = yield* Layer.build(
        NodeHttpServer.layer(createServer, { host: "127.0.0.1", port: 0 }),
      );
      const registry = yield* Layer.build(
        McpSessionRegistry.layer.pipe(
          Layer.provide(
            Layer.succeed(ServerEnvironment, {
              getEnvironmentId: Effect.succeed(environmentId),
              getDescriptor: Effect.die("unused"),
            }),
          ),
        ),
      ).pipe(Effect.provide(http));
      const invocations: string[] = [];
      const layerDevices = Layer.mock(DeviceService)({
        authorizeScreenshotTransfer: () => Effect.succeed(() => true),
        state: Effect.succeed({
          hosts: [],
          devices: [],
          sessions: [],
          hostStatus: "ready",
          hostStatuses: {},
          onboardingCompleted: true,
          agentAccessEnabled: true,
          hubBasePath: "/api/device-hub",
          revision: 1,
        }),
        comparison: (input, _sessionId, caller) =>
          Effect.sync(() => {
            invocations.push(input.action);
            expect(input).toMatchObject({ threadId, runId: deviceRun.runId });
            expect(caller).toMatchObject({ threadId, providerInstanceId: instanceId });
            if (input.action === "replay") {
              expect(input.approvalId).toBe(approvalId);
              return {
                run: { ...deviceRun, phase: "running" as const, busy: true, playing: true },
              };
            }
            if (input.action === "status") {
              return input.waitForCheckpoint
                ? { run: deviceRun, approvedEvidence }
                : { run: { ...deviceRun, phase: "completed" as const, canResume: false } };
            }
            expect(input.action).toBe("evidence");
            return {
              run: deviceRun,
              approvedEvidence,
              evidence: { sourcePng: png, targetPng: png },
            };
          }),
        comparisonRecording: (input, caller) =>
          Effect.sync(() => {
            invocations.push(input.action);
            expect(caller).toMatchObject({ threadId, providerInstanceId: instanceId });
            expect(caller.providerSessionId).toBeTruthy();
            if (input.action === "scroll") {
              expect(input).toEqual(recordingScroll);
              return {
                run: {
                  runId: recordingScroll.runId,
                  phase: "recording",
                  approvalId,
                  source: deviceRun.source,
                  target: deviceRun.target,
                  agentRecording: { manual: false },
                  busy: false,
                  playing: false,
                  completedSteps: 0,
                  steps: [{ label: "Scroll down", scrollDirection: "down" }],
                  canResume: false,
                  uncertainTap: false,
                },
              };
            }
            expect(input).toEqual(proposal);
            return {
              run: {
                runId: proposalRunId,
                phase: "awaiting_approval",
                source: deviceRun.source,
                target: { ...proposal.target, name: "Fixture Pixel", platform: "android" },
                agentRecording: { manual: false, evidenceDestination },
                busy: false,
                playing: false,
                completedSteps: 0,
                steps: [],
                canResume: false,
                uncertainTap: false,
              },
            };
          }),
        agentScreenshot: () => Effect.die("Frozen evidence must not require a live simulator"),
      });
      const layerBroker = Layer.mock(PreviewAutomationBroker)({
        invoke: <A>(input: Parameters<PreviewAutomationBroker["Service"]["invoke"]>[0]) =>
          Effect.gen(function* () {
            if (input.desktopSessionId !== undefined) throw new Error("Expected a provider call");
            expect(input.scope.environmentId).toBe(environmentId);
            expect(input.scope.thread.threadId).toBe(threadId);
            expect(input.scope.thread.providerInstanceId).toBe(instanceId);
            expect(input.tabId).toBe(workTab);
            expect(input.operation).toBe("deviceScreenshotUpload");
            const payload = input.input as { phase: string };
            invocations.push(payload.phase);
            if (payload.phase === "inspect") {
              expect(input.input).toEqual({ phase: "inspect", grantId, selector });
              input.onConnection?.("fixture-work-host");
              return {
                ...source,
                firstDifference: { runId: frame.runId, side: frame.side },
              } as A;
            }
            expect(input.requireConnectionId).toBe("fixture-work-host");
            expect(input.input).toEqual({
              phase: "attach",
              grantId,
              ...source,
              frame,
              selector,
              png,
            });
            expect(input.authorizeDeviceScreenshot).toBeDefined();
            expect(yield* input.authorizeDeviceScreenshot!.check).toBe(true);
            expect(input.authorizeDeviceScreenshot!.isCurrent()).toBe(true);
            return { attached: true } as A;
          }),
      });
      const fixture = responsesFixture();
      const layerMcpRoutes = McpServer.layerHttp({
        protocols: [McpProtocol.v2025_06_18],
        name: "Tabs",
        version: "1",
        path: "/mcp",
      }).pipe(
        Layer.provide(
          HttpRouter.middleware<{ provides: McpInvocationContext }>()(
            McpHttpServer.makeMcpAuthMiddleware,
          ).layer,
        ),
      );
      const layerTerminal = Layer.mock(TerminalManager)({
        proposeAgentInput: (caller, input) =>
          Effect.sync(() => {
            invocations.push("terminal proposal");
            expect(caller).toMatchObject({ threadId, providerInstanceId: instanceId });
            expect(caller.providerSessionId).toBeTruthy();
            expect(input).toMatchObject({
              terminalId: terminalProposal.terminalId,
              instanceId: terminalProposal.instanceId,
              text: terminalProposal.text,
              pressEnter: true,
            });
            return { requestId: terminalRequestId, status: "pending" as const };
          }),
      });
      const layerTools = Layer.mergeAll(
        McpHttpServer.layerDeviceToolkit.pipe(
          Layer.provide(Layer.mergeAll(layerDevices, layerBroker)),
        ),
        McpHttpServer.layerTerminalInputToolkit.pipe(Layer.provide(layerTerminal)),
      ) as Layer.Layer<never, unknown>;
      yield* Layer.build(
        HttpRouter.serve(
          Layer.mergeAll(fixture.routes, layerMcpRoutes, layerTools).pipe(
            Layer.provide(McpHttpServer.layerMcpServer),
          ),
          { disableListenLog: true, disableLogger: true },
        ),
      ).pipe(Effect.provide(config), Effect.provide(registry), Effect.provide(http));

      const address = Context.get(http, HttpServer.HttpServer).address;
      if (address._tag !== "TcpAddress")
        return yield* Effect.die("Expected a loopback TCP listener");
      const loopback = `http://127.0.0.1:${address.port}`;
      yield* fs.writeFileString(
        join(directory, "config.toml"),
        `
model_provider = "tabs-fixture"
cli_auth_credentials_store = "file"
[features]
plugins = false
[analytics]
enabled = false
[model_providers.tabs-fixture]
name = "Tabs fixture"
base_url = "${loopback}/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
`,
      );

      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const layerClientFactory = Layer.succeed(CodexAdapterV2.CodexAppServerClientFactory, {
        open: ({ providerSessionId }) =>
          Effect.gen(function* () {
            if (binary === undefined) return yield* Effect.die("Missing fixture binary");
            const handle = yield* spawner
              .spawn(
                ChildProcess.make(binary, ["app-server"], {
                  cwd: directory,
                  env: {
                    PATH: process.env.PATH,
                    HOME: directory,
                    CODEX_HOME: directory,
                    TMPDIR: directory,
                    HTTPS_PROXY: "http://127.0.0.1:1",
                    HTTP_PROXY: "http://127.0.0.1:1",
                    ALL_PROXY: "http://127.0.0.1:1",
                    NO_PROXY: "127.0.0.1",
                    GIT_CONFIG_NOSYSTEM: "1",
                  },
                  extendEnv: false,
                }),
              )
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new ProviderAdapterOpenSessionError({
                      driver: CodexAdapterV2.CODEX_DRIVER_KIND,
                      providerSessionId,
                      cause,
                    }),
                ),
              );
            const client = yield* Layer.build(CodexClient.layerChildProcess(handle));
            return Context.get(client, CodexClient.CodexAppServerClient);
          }),
      });
      const layerProviders = ProviderAdapterRegistry.layerFromDrivers({
        drivers: [CodexAdapterV2.CodexAdapterV2Driver],
        configMap: {
          [instanceId]: {
            driver: CodexAdapterV2.CODEX_DRIVER_KIND,
            config: { homePath: directory },
          },
        },
      }).pipe(
        Layer.provide(layerClientFactory),
        Layer.provide(IdAllocator.layer),
        Layer.provide(layerConfig),
        Layer.provide(NodeServices.layer),
      );

      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        yield* orchestrator.dispatch({
          type: "thread.create",
          commandId: CommandId.make("create-codex-mcp-evidence"),
          threadId,
          projectId,
          title: "Codex MCP evidence",
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: directory,
          createdBy: "user",
          creationSource: "web",
        });
        const turnSettled = yield* orchestrator.streamDomainEvents.pipe(
          Stream.filter(
            (event) =>
              event.type === "run.updated" &&
              ["waiting", "completed", "failed", "interrupted"].includes(event.payload.status),
          ),
          Stream.runHead,
          Effect.forkChild({ startImmediately: true }),
        );
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("start-codex-mcp-evidence"),
          threadId,
          messageId: MessageId.make("message:codex-mcp-evidence"),
          text: "Replay the approved demonstration, attach the comparison evidence to Work, then prepare another comparison and the terminal input for my approval. Check the original replay status again after correction.",
          attachments: [],
          createdBy: "user",
          creationSource: "web",
          dispatchMode: { type: "start_immediately" },
        });
        yield* worker.drain();
        yield* Fiber.join(turnSettled).pipe(Effect.timeout("10 seconds"));
        yield* worker.drain();

        const projection = projectThreadProjectionForWire(
          yield* orchestrator.getThreadProjection(threadId),
        );
        expect(projection.runs.at(-1)?.status).toBe("completed");
        expect(fixture.requests).toHaveLength(toolCalls.length + 1);
        expect(
          fixture.requests[0]?.tools
            ?.find(({ name }) => name === "mcp__t3_code")
            ?.tools?.map(({ name }) => name),
        ).toEqual(
          expect.arrayContaining([
            "device_comparison_status",
            "device_replay_demonstration",
            "device_attach_screenshot",
            "device_record_comparison",
            "terminal_input",
          ]),
        );
        const terminalDescriptor = fixture.requests[0]?.tools
          ?.find(({ name }) => name === "mcp__t3_code")
          ?.tools?.find(({ name }) => name === "terminal_input");
        expect(terminalDescriptor?.parameters?.type).toBe("object");
        const comparisonOutput = fixture.requests[1]?.input?.find(
          (item) => item.call_id === "call-0" && item.type === "function_call_output",
        )?.output;
        expect(comparisonOutput).toEqual(expect.stringContaining("Fixture totals differ"));
        expect(comparisonOutput).toEqual(expect.stringContaining(JSON.stringify(approvedEvidence)));
        const attachmentOutput = fixture.requests[2]?.input?.find(
          (item) => item.call_id === "call-1" && item.type === "function_call_output",
        )?.output;
        expect(attachmentOutput).toEqual(expect.stringContaining('"status":"file_selected"'));
        expect(attachmentOutput).toEqual(expect.stringContaining(digest));
        expect(attachmentOutput).not.toEqual(expect.stringContaining(png));
        const proposalOutput = fixture.requests[3]?.input?.find(
          (item) => item.call_id === "call-2" && item.type === "function_call_output",
        )?.output;
        expect(proposalOutput).toEqual(expect.stringContaining('"phase":"awaiting_approval"'));
        expect(proposalOutput).toEqual(expect.stringContaining(proposalRunId));
        const terminalOutput = fixture.requests[4]?.input?.find(
          (item) => item.call_id === "call-3" && item.type === "function_call_output",
        )?.output;
        expect(terminalOutput).toEqual(expect.stringContaining(terminalRequestId));
        expect(terminalOutput).not.toEqual(expect.stringContaining(terminalProposal.text));
        const scrollOutput = fixture.requests[5]?.input?.find(
          (item) => item.call_id === "call-4" && item.type === "function_call_output",
        )?.output;
        expect(scrollOutput).toEqual(expect.stringContaining(recordingScroll.runId));
        expect(scrollOutput).toEqual(expect.stringContaining('"scrollDirection":"down"'));
        const correctedOutput = fixture.requests[6]?.input?.find(
          (item) => item.call_id === "call-5" && item.type === "function_call_output",
        )?.output;
        expect(correctedOutput).toEqual(expect.stringContaining('"phase":"completed"'));
        expect(invocations).toEqual([
          "replay",
          "status",
          "inspect",
          "evidence",
          "evidence",
          "attach",
          "evidence",
          "propose",
          "terminal proposal",
          "scroll",
          "status",
        ]);
        expect(projection.turnItems.filter((item) => item.type === "dynamic_tool")).toMatchObject([
          {
            status: "completed",
            toolName: "t3-code.device_replay_demonstration",
            threadId,
            output: { deviceDifference: { runId: deviceRun.runId, step: 1 } },
          },
          { status: "completed", toolName: "t3-code.device_attach_screenshot", threadId },
          {
            status: "completed",
            toolName: "t3-code.device_record_comparison",
            threadId,
            output: { deviceComparisonRequest: { runId: proposalRunId } },
          },
          {
            status: "completed",
            toolName: "t3-code.terminal_input",
            threadId,
            input: undefined,
            output: { terminalAgentInput: { requestId: terminalRequestId } },
          },
          { status: "completed", toolName: "t3-code.device_record_comparison", threadId },
          {
            status: "completed",
            toolName: "t3-code.device_comparison_status",
            threadId,
            output: {
              deviceDifference: { runId: deviceRun.runId, step: 1 },
              deviceCompletion: { runId: deviceRun.runId },
            },
          },
        ]);
      }).pipe(
        Effect.provide(
          ProviderReplayHarness.layerWithRegistry(
            {
              name: "codex-mcp-evidence",
              runtimePolicyOverride: { cwd: directory },
            },
            layerProviders,
            {
              runEffectWorker: false,
              serverConfigLayer: layerConfig,
              mcp: { registry: Layer.succeedContext(registry), enableAgentDeviceAccess: true },
            },
          ),
        ),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  20_000,
);
