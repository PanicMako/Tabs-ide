import { expect, it } from "@effect/vitest";
import { createHash } from "node:crypto";
import { vi } from "vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type DeviceComparisonFirstDifference,
  type DeviceComparisonFrame,
  type DeviceComparisonRecording,
  type DeviceComparisonStatus,
  type DevicePlatform,
  DeviceComparisonError,
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/unstable/ai";

import * as ServerConfig from "../config.ts";
import * as DeviceService from "../device/DeviceService.ts";
import * as PreviewAutomationBroker from "./PreviewAutomationBroker.ts";
import * as McpHttpServer from "./McpHttpServer.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";

const environmentId = EnvironmentId.make("environment-device-test");
const threadId = ThreadId.make("thread-device-test");
const invocation = (capabilities: ReadonlyArray<McpInvocationContext.McpCapability>) => ({
  environmentId,
  requestNamespace: "provider-session-device-test",
  thread: {
    threadId,
    providerSessionId: "provider-session-device-test",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(capabilities),
  issuedAt: 1,
});
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "mcp-test", version: "1.0.0" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mcp-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

const device = {
  hostId: "local",
  id: "UDID-1",
  platform: "ios" as const,
  name: "iPhone 17 Pro",
  version: "iOS 27.0",
  booted: true,
  physical: false,
};
const recordingProposal = {
  action: "propose",
  source: { hostId: device.hostId, deviceId: device.id, appId: "com.tabs.fixture.ios" },
  target: { hostId: "remote", deviceId: device.id, appId: "com.tabs.fixture.android" },
  total: { sourceLabel: "Total", targetLabel: "Order total", currency: "USD" },
} as const satisfies DeviceComparisonRecording;
const recordingProposalWithEvidence = {
  ...recordingProposal,
  evidenceDestination: {
    tabId: "qa-tab",
    profileId: "work",
    pageRef: "a".repeat(64),
    instanceId: "f23ec06e-b16e-48ba-a998-72c2ab0ad6ad",
  },
} as const satisfies DeviceComparisonRecording;
const proposedRunId = "e4de048c-1f4f-43aa-bb54-aed5f4741e60";
const proposedRun = {
  runId: proposedRunId,
  phase: "awaiting_approval" as const,
  source: { ...recordingProposal.source, platform: "ios" as const, name: "iPhone" },
  target: { ...recordingProposal.target, platform: "android" as const, name: "Pixel" },
  steps: [],
  busy: false,
  playing: false,
  completedSteps: 0,
  canResume: false,
  uncertainTap: false,
};
const state = {
  hosts: [
    {
      id: "local",
      kind: "local" as const,
      label: "This machine",
      platforms: [
        { platform: "ios" as const, available: true },
        { platform: "android" as const, available: false, reason: "No SDK" },
      ],
      hubInstalled: true,
      agentDeviceInstalled: true,
    },
  ],
  hostStatus: "ready" as const,
  hostStatuses: { local: { status: "ready" as const } },
  devices: [device],
  sessions: [],
  onboardingCompleted: true,
  agentAccessEnabled: true,
  hubBasePath: "/api/device-hub",
  revision: 1,
};
const png = new Uint8Array(24);
new DataView(png.buffer).setUint32(0, 0x89504e47);
new DataView(png.buffer).setUint32(4, 0x0d0a1a0a);
new DataView(png.buffer).setUint32(12, 0x49484452);
new DataView(png.buffer).setUint32(16, 1206);
new DataView(png.buffer).setUint32(20, 2622);

const layerDeviceServiceMock = Layer.mock(DeviceService.DeviceService)({
  state: Effect.succeed({
    ...state,
    sessions: [
      {
        threadId,
        hostId: device.hostId,
        deviceId: device.id,
        platform: device.platform,
        openedAt: "2026-11-25T00:00:00.000Z",
      },
    ],
  }),
  list: Effect.succeed(state),
  open: (input) =>
    Effect.succeed({
      threadId: input.threadId,
      hostId: "local",
      deviceId: input.deviceId,
      platform: input.platform,
      openedAt: "2026-09-08T00:00:00.000Z",
    }),
  comparison: (input, session, caller) =>
    Effect.sync((): DeviceComparisonStatus => {
      expect(session).toBeUndefined();
      expect(caller).toEqual(invocation(["device"]).thread);
      if (input.action === "requestDeviceApp") {
        expect(input.device).toEqual({ hostId: device.hostId, deviceId: device.id });
        return { pendingAppApproval: { id: proposedRunId, appId: input.appId } };
      }
      if (input.action === "status" && input.runId === proposedRunId) {
        expect(input).toEqual({ action: "status", threadId, runId: proposedRunId });
        return {
          run: { ...proposedRun, phase: "paused" },
          approvedEvidence: { tabId: approvedTab, grantIds: [grantId, pairedGrantId] },
        };
      }
      expect(input).toEqual({ action: "status", threadId });
      return {};
    }),
  comparisonRecording: (input, caller) =>
    Effect.sync(() => {
      expect(input).toEqual(
        "evidenceDestination" in input ? recordingProposalWithEvidence : recordingProposal,
      );
      expect(caller).toEqual(invocation(["device"]).thread);
      return { run: proposedRun };
    }),
  sessionsForThread: () => Effect.succeed([]),
  agentScreenshot: () => Effect.succeed({ device, png }),
  close: () => Effect.void,
  agentCli: Effect.succeed("/cli"),
  testHost: () => Effect.die("not used"),
  agentTarget: (session, caller, _path, access) =>
    Effect.sync(() => {
      expect(session).toMatchObject({ threadId, hostId: device.hostId, deviceId: device.id });
      expect(caller).toEqual(invocation(["device"]).thread);
      expect(access).toEqual({ appId: "com.example.checkout", approvalId: proposedRunId });
      return { command: "/tabs/agent-device", configPath: "/grant.json", session: "thread-device" };
    }),
});

const layerTest = McpHttpServer.layerDeviceToolkit.pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provideMerge(layerDeviceServiceMock),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-mcp-device-toolkit-test-" })),
  Layer.provide(NodeServices.layer),
);

it.effect(
  "registers the device tools and returns the screenshot as image content",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* McpServer.McpServer;
        const names = server.tools.map(({ tool }) => tool.name).toSorted();
        expect(names).toEqual([
          "device_attach_screenshot",
          "device_close",
          "device_comparison_status",
          "device_list",
          "device_open",
          "device_record_comparison",
          "device_replay_demonstration",
          "device_screenshot",
          "device_stop_comparison",
        ]);

        const callWith = (capabilities: ReadonlyArray<McpInvocationContext.McpCapability>) =>
          Effect.provideService(
            McpInvocationContext.McpInvocationContext,
            invocation(capabilities),
          );

        const appId = "com.example.checkout";
        const proposal = yield* server
          .callTool({
            name: "device_open",
            arguments: {
              platform: "ios",
              appId,
            },
          })
          .pipe(callWith(["device"]), Effect.provideService(McpSchema.McpServerClient, client));
        expect(proposal.isError).toBe(false);
        expect(proposal.structuredContent).toMatchObject({
          status: "approval_required",
          approval: { id: proposedRunId, appId },
        });
        expect(proposal.structuredContent).not.toHaveProperty("agentDevice");
        const opened = yield* server
          .callTool({
            name: "device_open",
            arguments: { platform: "ios", appId, approvalId: proposedRunId },
          })
          .pipe(callWith(["device"]), Effect.provideService(McpSchema.McpServerClient, client));
        expect(opened.isError).toBe(false);
        const openedContent = opened.structuredContent as { quickStart: string };
        expect(openedContent.quickStart).toContain("--udid UDID-1");

        for (const [name, args] of [
          ["device_open", { deviceId: "unattached" }],
          ["device_open", { deviceId: device.id, hostId: "another-host" }],
          ["device_close", { deviceId: device.id, shutdown: true }],
        ] as const) {
          const refused = yield* server
            .callTool({ name, arguments: args })
            .pipe(callWith(["device"]), Effect.provideService(McpSchema.McpServerClient, client));
          expect(refused.isError).toBe(true);
        }

        const shot = yield* server
          .callTool({ name: "device_screenshot", arguments: { deviceId: "UDID-1" } })
          .pipe(callWith(["device"]), Effect.provideService(McpSchema.McpServerClient, client));
        expect(shot.isError).toBe(false);
        expect(shot.content.map((entry) => entry.type)).toEqual(["text", "image"]);
        expect(shot.structuredContent).toMatchObject({
          screenshot: { mimeType: "image/png", width: 1206, height: 2622 },
        });

        const denied = yield* server
          .callTool({ name: "device_list", arguments: {} })
          .pipe(callWith(["preview"]), Effect.provideService(McpSchema.McpServerClient, client));
        expect(denied.isError).toBe(true);

        const comparison = server
          .callTool({ name: "device_comparison_status", arguments: {} })
          .pipe(Effect.provideService(McpSchema.McpServerClient, client));
        expect((yield* comparison.pipe(callWith(["device"]))).structuredContent).toEqual({});
        expect((yield* comparison.pipe(callWith(["preview"]))).isError).toBe(true);

        const propose = server
          .callTool({ name: "device_record_comparison", arguments: recordingProposal })
          .pipe(Effect.provideService(McpSchema.McpServerClient, client));
        const proposed = yield* propose.pipe(callWith(["device"]));
        expect(proposed.isError).toBe(false);
        expect(proposed.structuredContent).toMatchObject({
          run: {
            runId: proposedRunId,
            phase: "awaiting_approval",
            source: recordingProposal.source,
            target: recordingProposal.target,
          },
        });
        expect(proposed.structuredContent).not.toHaveProperty("run.approvalId");
        expect(proposed.structuredContent).not.toHaveProperty("controls");
        expect((yield* propose.pipe(callWith(["preview"]))).isError).toBe(true);

        const proposeWithEvidence = server
          .callTool({ name: "device_record_comparison", arguments: recordingProposalWithEvidence })
          .pipe(Effect.provideService(McpSchema.McpServerClient, client));
        expect((yield* proposeWithEvidence.pipe(callWith(["device"]))).isError).toBe(true);
        expect((yield* proposeWithEvidence.pipe(callWith(["device", "preview"]))).isError).toBe(
          false,
        );

        const comparisonWithEvidence = server
          .callTool({ name: "device_comparison_status", arguments: { runId: proposedRunId } })
          .pipe(Effect.provideService(McpSchema.McpServerClient, client));
        const deviceOnly = yield* comparisonWithEvidence.pipe(callWith(["device"]));
        expect(deviceOnly.structuredContent).toMatchObject({ run: { runId: proposedRunId } });
        expect(deviceOnly.structuredContent).not.toHaveProperty("approvedEvidence");
        const withPreview = yield* comparisonWithEvidence.pipe(callWith(["device", "preview"]));
        expect(withPreview.structuredContent).toMatchObject({
          approvedEvidence: { tabId: approvedTab, grantIds: [grantId, pairedGrantId] },
        });

        const attemptedApproval = yield* server
          .callTool({
            name: "device_record_comparison",
            arguments: { action: "approveAgentRecording", runId: proposedRunId },
          })
          .pipe(
            callWith(["device"]),
            Effect.provideService(McpSchema.McpServerClient, client),
            Effect.flip,
          );
        expect(attemptedApproval).toMatchObject({ _tag: "InvalidParams" });
      }),
    ).pipe(Effect.provide(layerTest)) as any,
);

it.effect("rejects unavailable agent access before booting or opening a device", () => {
  const layerUnavailable = Layer.mock(DeviceService.DeviceService)({
    state: Effect.succeed({ ...state, agentAccessEnabled: false }),
    agentTarget: () => Effect.die("Must not prepare the CLI without access"),
    open: () => Effect.die("Must not boot or register a device when agent access fails"),
  });
  return Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({ name: "device_open", arguments: { platform: "ios" } })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(["device"])),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(result.isError).toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("Agent device access is disabled."),
        }),
      ]),
    );
  }).pipe(
    Effect.scoped,
    Effect.provide(
      McpHttpServer.layerDeviceToolkit.pipe(
        Layer.provideMerge(McpServer.McpServer.layer),
        Layer.provide(layerUnavailable),
        Layer.provide(NodeServices.layer),
      ),
    ),
  ) as any;
});

const approvedTab = "qa-tab";
const grantId = "d73c703b-7e11-4857-8848-538fe29be608";
const pairedGrantId = "07e2eb26-b6f5-401d-aad5-babaf373a59e";
const completePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XHfQAAAAASUVORK5CYII=",
  "base64",
);
const targetPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);

function callTransfer(capabilities: ReadonlyArray<McpInvocationContext.McpCapability>) {
  return Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    return yield* server
      .callTool({
        name: "device_attach_screenshot",
        arguments: { grantId, tabId: approvedTab, selector: "#evidence" },
      })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(capabilities)),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
  });
}

function transferFixture(input: {
  deviceId: string;
  platform?: DevicePlatform;
  capture: () => Promise<Uint8Array>;
  deliver: (png: string) => Promise<boolean>;
  selected?: () => { sha256: string; sizeBytes: number; frame?: DeviceComparisonFrame } | undefined;
  access?: boolean;
  beforeClaim?: () => void;
  accessGeneration?: () => number;
  attachmentGeneration?: () => number;
  sessionHost?: string;
  frame?: DeviceComparisonFrame;
  firstDifference?: DeviceComparisonFirstDifference;
  recordedStep?: number;
  savedAt?: string;
  updateEvidence?: (status: DeviceComparisonStatus, read: number) => DeviceComparisonStatus;
}) {
  const source = { deviceId: input.deviceId, hostId: "local" };
  const platform = input.platform ?? "ios";
  let reads = 0;
  return McpHttpServer.layerDeviceToolkit.pipe(
    Layer.provideMerge(McpServer.McpServer.layer),
    Layer.provide(
      Layer.mock(DeviceService.DeviceService)({
        state: Effect.succeed({
          ...state,
          agentAccessEnabled: input.access ?? true,
          sessions: input.savedAt
            ? []
            : [
                {
                  ...source,
                  hostId: input.sessionHost ?? source.hostId,
                  threadId,
                  platform,
                  openedAt: "2026-11-25T00:00:00.000Z",
                },
              ],
        }),
        authorizeScreenshotTransfer: (caller, source) =>
          Effect.suspend(() => {
            expect(caller).toEqual(invocation(["device"]).thread);
            const generation = source ? input.attachmentGeneration : input.accessGeneration;
            const current = generation?.();
            const isCurrent = () => input.access !== false && generation?.() === current;
            return isCurrent()
              ? Effect.succeed(isCurrent)
              : Effect.fail(new DeviceComparisonError({ reason: "Device access changed." }));
          }),
        comparison: (request, session, caller) =>
          Effect.sync(() => {
            const { runId } = (input.firstDifference ?? input.frame)!;
            expect(request).toEqual({ runId, action: "evidence", threadId });
            expect(session).toBeUndefined();
            expect(caller).toEqual(
              input.firstDifference ? invocation(["device"]).thread : undefined,
            );
            const selectedDevice = {
              ...source,
              platform: "ios" as const,
              appId: "com.apple.mobilesafari",
              name: "iPhone",
            };
            const peerDevice = { ...selectedDevice, deviceId: "sim-B", hostId: "remote" };
            const isTarget = input.firstDifference?.side === "target";
            const status: DeviceComparisonStatus = {
              run: {
                runId,
                phase: input.savedAt ? ("stopped" as const) : ("paused" as const),
                ...(input.savedAt ? { savedAt: input.savedAt } : {}),
                source: isTarget ? peerDevice : selectedDevice,
                target: isTarget ? selectedDevice : peerDevice,
                firstDifference: {
                  step: input.recordedStep ?? input.frame?.step ?? 1,
                  kind: "total" as const,
                  reason: "Total differs",
                },
                busy: false,
                playing: false,
                completedSteps: 0,
                steps: [{ label: "Continue" }],
                canResume: !input.savedAt,
                uncertainTap: false,
              },
              evidence: {
                sourcePng: completePng.toString("base64"),
                ...(input.firstDifference && { targetPng: targetPng.toString("base64") }),
              },
              ...(input.firstDifference && {
                approvedEvidence: {
                  tabId: approvedTab,
                  grantIds: isTarget ? [pairedGrantId, grantId] : [grantId, pairedGrantId],
                },
              }),
            };
            reads += 1;
            return input.updateEvidence?.(status, reads) ?? status;
          }),
        agentScreenshot: (target, caller) =>
          Effect.promise(async () => {
            expect(caller.threadId).toBe(threadId);
            expect(target).toMatchObject(source);
            return {
              device: { ...device, id: input.deviceId, platform },
              png: await input.capture(),
            };
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(PreviewAutomationBroker.PreviewAutomationBroker)({
        invoke: <A>(req: PreviewAutomationBroker.PreviewAutomationInvokeInput) =>
          Effect.gen(function* () {
            expect(req.tabId).toBe(approvedTab);
            const payload = req.input as {
              phase: string;
              grantId: string;
              frame?: DeviceComparisonFrame;
              firstDifference?: DeviceComparisonFirstDifference;
              png: string;
            };
            expect(payload.grantId).toBe(grantId);
            if (payload.phase === "inspect") {
              req.onConnection?.("desktop-1");
              const selection = input.selected?.();
              return {
                ...source,
                ...(input.frame && !selection && { frame: input.frame }),
                ...(input.firstDifference && { firstDifference: input.firstDifference }),
                ...(selection && { selection }),
              } as A;
            }
            expect(req.requireConnectionId).toBe("desktop-1");
            if (input.firstDifference) {
              expect(reads).toBe(2);
              expect(payload.firstDifference).toBeUndefined();
              expect(payload.frame).toEqual({
                ...input.firstDifference,
                step: input.recordedStep ?? 1,
              });
            }
            input.beforeClaim?.();
            const authorization = req.authorizeDeviceScreenshot;
            if (!authorization || !(yield* authorization.check) || !authorization.isCurrent())
              return { attached: false } as A;
            return { attached: yield* Effect.promise(() => input.deliver(payload.png)) } as A;
          }),
      }),
    ),
    Layer.provide(NodeServices.layer),
  ) as Layer.Layer<McpServer.McpServer, unknown>;
}

it.effect(
  "returns the identity of the selected PNG without putting the screen in model output",
  () =>
    Effect.gen(function* () {
      const result = yield* callTransfer(["device", "preview"]);
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({
        status: "file_selected",
        deviceId: "sim-A",
        tabId: approvedTab,
        sizeBytes: completePng.length,
      });
      expect(JSON.stringify(result)).not.toContain(completePng.toString("base64"));
    }).pipe(
      Effect.provide(
        transferFixture({
          deviceId: "sim-A",
          capture: async () => completePng,
          deliver: async (png) => png === completePng.toString("base64"),
        }),
      ),
    ),
);

it.effect("returns a recovered receipt without another capture or write", () => {
  const receipt = {
    sha256: createHash("sha256").update(completePng).digest("hex"),
    sizeBytes: completePng.length,
  };
  const capture = vi.fn(async () => completePng);
  let selected = false;
  const deliver = vi.fn(async () => {
    selected = true;
    return false;
  });
  return Effect.gen(function* () {
    expect((yield* callTransfer(["device", "preview"])).isError).toBe(true);
    const result = yield* callTransfer(["device", "preview"]);
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      hostId: "local",
      deviceId: "sim-A",
      tabId: approvedTab,
      status: "file_selected",
      fileName: `device-${grantId}.png`,
      ...receipt,
    });
    expect(capture).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledOnce();
  }).pipe(
    Effect.provide(
      transferFixture({
        deviceId: "sim-A",
        capture,
        deliver,
        selected: () => (selected ? receipt : undefined),
      }),
    ),
  );
});

it.effect.each(["legacy", "first difference"] as const)(
  "recovers a %s frozen frame receipt without writing but rejects a different digest",
  (kind) => {
    const frame = { runId: proposedRunId, side: "source" as const, step: 1 };
    const deliver = vi.fn(async () => true);
    let sha256 = createHash("sha256").update(completePng).digest("hex");
    return Effect.gen(function* () {
      const receipt = yield* callTransfer(["device", "preview"]);
      expect(receipt.isError).toBe(false);
      expect(receipt.structuredContent).toMatchObject({ frame, sha256 });
      sha256 = createHash("sha256").update(targetPng).digest("hex");
      expect((yield* callTransfer(["device", "preview"])).isError).toBe(true);
      expect(deliver).not.toHaveBeenCalled();
    }).pipe(
      Effect.provide(
        transferFixture({
          deviceId: "sim-A",
          ...(kind === "legacy"
            ? { frame, savedAt: "2026-11-25T00:00:00.000Z" }
            : { firstDifference: { runId: frame.runId, side: frame.side } }),
          selected: () => ({ frame, sha256, sizeBytes: completePng.length }),
          capture: async () => {
            throw new Error("A receipt never needs a live capture");
          },
          deliver,
        }),
      ),
    );
  },
);

it.effect.each([1, 2])(
  "only transfers the immutable approved checkpoint (recorded step %d)",
  (recordedStep) => {
    const frame = {
      runId: "92724452-d32a-42f1-9771-75656595c621",
      side: "source" as const,
      step: 1,
    };
    return Effect.gen(function* () {
      const result = yield* callTransfer(["device", "preview"]);
      expect(result.isError).toBe(recordedStep !== frame.step);
      if (!result.isError)
        expect(result.structuredContent).toMatchObject({ frame, sizeBytes: completePng.length });
    }).pipe(
      Effect.provide(
        transferFixture({
          deviceId: "sim-A",
          frame,
          recordedStep,
          capture: async () => {
            throw new Error("Must never recapture the live screen");
          },
          deliver: async (png) => recordedStep === 1 && png === completePng.toString("base64"),
        }),
      ),
    );
  },
);

it.effect.each(["source", "target"] as const)(
  "resolves the approved first-difference %s to a concrete frame and rechecks it before attachment",
  (side) => {
    const firstDifference = { runId: proposedRunId, side };
    const expectedPng = side === "source" ? completePng : targetPng;
    return Effect.gen(function* () {
      const result = yield* callTransfer(["device", "preview"]);
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({
        frame: { ...firstDifference, step: 1 },
        sizeBytes: expectedPng.length,
      });
    }).pipe(
      Effect.provide(
        transferFixture({
          deviceId: "sim-A",
          firstDifference,
          capture: async () => {
            throw new Error("Must never recapture the live screen");
          },
          deliver: async (png) => png === expectedPng.toString("base64"),
        }),
      ),
    );
  },
);

it.effect.each([
  "early",
  "wrong tab",
  "wrong grant side",
  "wrong device",
  "missing other frame",
  "stopped",
  "revoked before dispatch",
  "revoked at point of use",
  "frame changed at point of use",
  "stopped before permit commit",
] as const)("refuses a first-difference transfer with %s", (condition) => {
  let evidenceGeneration = 0;
  return Effect.gen(function* () {
    expect((yield* callTransfer(["device", "preview"])).isError).toBe(true);
  }).pipe(
    Effect.provide(
      transferFixture({
        deviceId: "sim-A",
        firstDifference: { runId: proposedRunId, side: "source" },
        attachmentGeneration: () => evidenceGeneration,
        updateEvidence: (status, read) => {
          switch (condition) {
            case "early":
              return { run: status.run };
            case "wrong tab":
              return {
                ...status,
                approvedEvidence: { ...status.approvedEvidence!, tabId: "other" },
              };
            case "wrong grant side":
              return {
                ...status,
                approvedEvidence: { tabId: approvedTab, grantIds: [pairedGrantId, grantId] },
              };
            case "wrong device":
              return { ...status, run: { ...status.run!, source: status.run!.target! } };
            case "missing other frame":
              return { ...status, evidence: { sourcePng: status.evidence!.sourcePng } };
            case "stopped":
              return { ...status, run: { ...status.run!, phase: "stopped" } };
            case "revoked before dispatch":
              return read === 1 ? status : { ...status, approvedEvidence: undefined };
            case "revoked at point of use":
              return read < 3 ? status : { ...status, approvedEvidence: undefined };
            case "stopped before permit commit":
              if (read === 3) evidenceGeneration++;
              return status;
            case "frame changed at point of use":
              return read < 3
                ? status
                : {
                    ...status,
                    evidence: { ...status.evidence!, sourcePng: targetPng.toString("base64") },
                  };
          }
        },
        capture: async () => {
          throw new Error("Must never capture the live screen");
        },
        deliver: async () => {
          throw new Error("Must never deliver an unauthorized frame");
        },
      }),
    ),
  );
});

it.effect.each([
  "device access",
  "live agent grant",
  "legacy comparison attachment",
  "saved frame access",
] as const)(
  "refuses an attachment when %s is revoked and reenabled before the desktop claim",
  (revoked) => {
    let accessGeneration = 0;
    let attachmentGeneration = 0;
    const deliver = vi.fn(async () => true);
    return Effect.gen(function* () {
      expect((yield* callTransfer(["device", "preview"])).isError).toBe(true);
      expect(deliver).not.toHaveBeenCalled();
    }).pipe(
      Effect.provide(
        transferFixture({
          deviceId: "sim-A",
          ...((revoked === "legacy comparison attachment" || revoked === "saved frame access") && {
            frame: { runId: proposedRunId, side: "source", step: 1 },
          }),
          ...(revoked === "saved frame access" && { savedAt: "2026-11-25T00:00:00.000Z" }),
          capture: async () => {
            if (revoked === "saved frame access") throw new Error("A saved frame needs no capture");
            return completePng;
          },
          deliver,
          accessGeneration: () => accessGeneration,
          attachmentGeneration: () => attachmentGeneration,
          beforeClaim: () => {
            if (revoked === "device access" || revoked === "saved frame access") accessGeneration++;
            else attachmentGeneration++;
          },
        }),
      ),
    );
  },
);

it.effect.each([true, false])(
  "transfers a saved frame with no live device session only while agent device access is on (%s)",
  (access) => {
    const frame = {
      runId: "92724452-d32a-42f1-9771-75656595c621",
      side: "source" as const,
      step: 1,
    };
    return Effect.gen(function* () {
      const result = yield* callTransfer(["device", "preview"]);
      expect(result.isError).toBe(!access);
      if (access)
        expect(result.structuredContent).toMatchObject({ frame, sizeBytes: completePng.length });
    }).pipe(
      Effect.provide(
        transferFixture({
          deviceId: "sim-A",
          frame,
          access,
          savedAt: "2026-11-25T00:00:00.000Z",
          capture: async () => {
            throw new Error("A saved frame never needs a live capture");
          },
          deliver: async (png) => {
            if (!access) throw new Error("Agent access was revoked");
            return png === completePng.toString("base64");
          },
        }),
      ),
    );
  },
);

it.effect.each([
  { caps: ["preview"], access: true, sessionHost: "local" },
  { caps: ["device"], access: true, sessionHost: "local" },
  { caps: ["device", "preview"], access: false, sessionHost: "local" },
  { caps: ["device", "preview"], access: true, sessionHost: "other" },
] as const)("refuses unauthorized capture %#", ({ caps, access, sessionHost }) =>
  Effect.gen(function* () {
    expect((yield* callTransfer(caps)).isError).toBe(true);
  }).pipe(
    Effect.provide(
      transferFixture({
        deviceId: "sim-A",
        access,
        sessionHost,
        capture: async () => {
          throw new Error("unexpected capture");
        },
        deliver: async () => {
          throw new Error("unexpected transfer");
        },
      }),
    ),
  ),
);

/** Opt in with the exact identifier of a booted disposable device. */
it.for([
  { platform: "ios" as const, deviceId: process.env.TABS_QA_SIMULATOR_UDID },
  { platform: "android" as const, deviceId: process.env.TABS_QA_ANDROID_SERIAL },
])(
  "transfers a live $platform PNG into a Work-only draft",
  { timeout: 60_000 },
  async ({ platform, deviceId }, { skip }) => {
    if (!deviceId) return skip();
    if (platform === "ios" && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(deviceId)) {
      throw new Error("Provide the disposable simulator’s exact UDID.");
    }
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { chromium } = await import("playwright");
    const { startDeviceDraftApp } = await import("../../scripts/fixtures/deviceDraft.ts");
    const { deviceScreenshotInputScript } =
      await import("../../../desktop/src/deviceScreenshotInput.ts");
    const browser = await chromium.launch();
    const fixture = await startDeviceDraftApp();
    const directory = await mkdtemp(join(tmpdir(), "tabs-device-evaluation-"));
    try {
      const work = await browser.newContext();
      const personal = await browser.newContext();
      const page = await work.newPage();
      const other = await personal.newPage();
      await page.goto(fixture.origin + "/Work");
      await other.goto(fixture.origin + "/Personal");
      const cdp = await work.newCDPSession(page);
      const { frameTree } = await cdp.send("Page.getFrameTree");
      const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
        frameId: frameTree.frame.id,
        worldName: "tabs-transfer-test",
      });
      const inspect = await cdp.send("Runtime.evaluate", {
        expression: deviceScreenshotInputScript(page.url(), "#evidence", null, grantId),
        contextId: executionContextId,
        returnByValue: true,
      });
      expect(inspect.result.value).toBe(true);
      const started = performance.now();
      const result = await Effect.runPromise(
        callTransfer(["device", "preview"]).pipe(
          Effect.provide(
            transferFixture({
              deviceId,
              platform,
              capture: async () => {
                if (platform === "android") {
                  const { stdout } = await exec(
                    "adb",
                    ["-s", deviceId, "exec-out", "screencap", "-p"],
                    { encoding: "buffer", maxBuffer: 24 * 1024 * 1024, timeout: 15_000 },
                  );
                  return stdout;
                }
                const image = join(directory, "screen.png");
                await exec("xcrun", ["simctl", "io", deviceId, "screenshot", "--type=png", image]);
                return readFile(image);
              },
              deliver: async (png) => {
                const response = await cdp.send("Runtime.evaluate", {
                  contextId: executionContextId,
                  returnByValue: true,
                  expression: deviceScreenshotInputScript(page.url(), "#evidence", png, grantId),
                });
                return response.result.value === true;
              },
            }),
          ),
        ),
      );
      expect(
        result.isError,
        result.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join(" "),
      ).toBe(false);
      expect(result.structuredContent).toMatchObject({ deviceId, hostId: "local" });
      const receipt = result.structuredContent as { sha256: string; sizeBytes: number };
      await page.getByRole("button", { name: "Save draft" }).click();
      await page.waitForURL("**/draft/*");
      await page.reload();
      expect(await page.locator("code").innerText()).toBe(receipt.sha256);
      expect(fixture.drafts.size).toBe(1);
      expect((await other.goto(page.url()))?.status()).toBe(404);
      process.stdout.write(
        JSON.stringify({
          workflow: "device-draft",
          platform,
          elapsedMs: Math.round(performance.now() - started),
          sizeBytes: receipt.sizeBytes,
          drafts: fixture.drafts.size,
        }) + "\n",
      );
    } finally {
      await browser.close();
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
