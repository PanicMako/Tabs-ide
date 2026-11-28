import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  FigmaCanvasBrowserRequest,
  FigmaCanvasResultRef,
  PreviewAutomationUnavailableError,
  PreviewTabId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type FigmaCanvasTarget,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { McpSchema, McpServer } from "effect/unstable/ai";
import { expect, it, vi } from "vitest";

import * as ServerConfig from "../../../config.ts";
import { ServerEnvironment } from "../../../environment/ServerEnvironment.ts";
import { ProviderAdapterProtocolError } from "../../../orchestration-v2/ProviderAdapter.ts";
import { ProviderSessionManagerV2 } from "../../../orchestration-v2/ProviderSessionManager.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import { McpInvocationContext, type McpThreadInvocationScope } from "../../McpInvocationContext.ts";
import * as Registry from "../../McpSessionRegistry.ts";
import {
  PreviewAutomationBroker,
  type PreviewAutomationInvokeInput,
} from "../../PreviewAutomationBroker.ts";
import type { FigmaMcpConnection } from "./connection.ts";
import { buildFigmaFrameProbe, buildFigmaFrameScript } from "./frameScript.ts";
import { figmaCanvasJournal } from "./journal.ts";

const environmentId = EnvironmentId.make("figma-test-environment");
const threadId = ThreadId.make("figma-owner-thread");
const target: FigmaCanvasTarget = {
  projectId: "figma-project",
  tabId: PreviewTabId.make("figma-design-tab"),
  profileId: "work",
  hostKey: "desktop-work",
  attachmentId: "11111111-1111-4111-8111-111111111111",
  mainFileKey: "source-file",
  fileKey: "active-branch",
  nodeId: "21:7",
};
const frame = { name: "Checkout preview", text: 'Review "billing"\nSave', width: 420, height: 240 };
const email = "designer@example.test";
const nodeIds = { frameNodeId: "21:8", textNodeId: "21:9" };
const clientInfo = { name: "figma-canvas-test", version: "1.0" };
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo,
  initializePayload: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo },
  getClient: Effect.die("unused"),
});

function makeFixture() {
  const desktop = {
    status: "approval_required" as "approval_required" | "approved",
    dispatchAllowed: false,
    attachmentOpen: true,
  };
  const onBrowserRequest = vi.fn((request: typeof FigmaCanvasBrowserRequest.Type): unknown => {
    switch (request.action) {
      case "inspect":
        return desktop.attachmentOpen ? target : null;
      case "authorize": {
        const { action: _action, ...write } = request;
        return {
          status: desktop.status,
          approval: { id: "22222222-2222-4222-8222-222222222222", ...write },
        };
      }
      case "dispatch":
        desktop.status = "approval_required";
        return desktop.dispatchAllowed;
    }
  });
  const invoke = <A>(input: PreviewAutomationInvokeInput) =>
    Effect.gen(function* () {
      if (input.scope.thread.threadId !== threadId) {
        return yield* new PreviewAutomationUnavailableError({
          capability: "preview",
          environmentId,
          ...input.scope.thread,
        });
      }
      const request = Schema.decodeUnknownSync(FigmaCanvasBrowserRequest)(input.input);
      const connectionId = "trusted-desktop";
      expect(input.operation).toBe("figmaCanvas");
      expect(input.tabId).toBe(target.tabId);
      expect(input.updateCurrentTab).toBe(false);
      if (request.action !== "inspect" || input.workflowHostKey !== undefined) {
        expect(input.requireConnectionId).toBe(connectionId);
        expect(input.workflowHostKey).toBe(target.hostKey);
      }
      input.onConnection?.(connectionId);
      return onBrowserRequest(request) as A;
    });

  const provider = { origin: "https://mcp.figma.com", requiredExtraArgument: false };
  const whoami = vi.fn(() => email);
  const canvas = { frameExists: false };
  const useFigma = vi.fn((args: Readonly<Record<string, string>>) => {
    if (args.skillNames === "figma-use,figma-generate-design") {
      canvas.frameExists = true;
      return Effect.fail(
        new ProviderAdapterProtocolError({
          driver: ProviderDriverKind.make("codex"),
          detail: "Synthetic lost write reply",
        }),
      );
    }
    return Effect.succeed({
      structuredContent: canvas.frameExists
        ? { status: "existing", parentNodeId: target.nodeId, ...nodeIds }
        : { status: "absent", parentNodeId: target.nodeId },
    });
  });
  const connection: FigmaMcpConnection = {
    list: () =>
      Effect.sync(() => ({
        data: [
          {
            name: "figma",
            httpOrigin: provider.origin,
            authStatus: "oAuth",
            runtimeStatus: "connected",
            tools: {
              whoami: { inputSchema: { type: "object", additionalProperties: false } },
              use_figma: {
                inputSchema: {
                  type: "object",
                  properties: {
                    fileKey: { type: "string" },
                    javascript: { type: "string" },
                    skillNames: { type: "string" },
                    editorType: { const: "figma" },
                    extra: { type: "string" },
                  },
                  required: [
                    "fileKey",
                    "javascript",
                    "skillNames",
                    "editorType",
                    ...(provider.requiredExtraArgument ? ["extra"] : []),
                  ],
                  additionalProperties: false,
                },
              },
            },
          },
        ],
      })),
    call: (name, args) => {
      if (name === "whoami") return Effect.sync(() => ({ structuredContent: { email: whoami() } }));
      if (name === "use_figma") return useFigma(args);
      return Effect.die("Unexpected Figma tool");
    },
  };
  const closeConnection = vi.fn();
  const openConnection = vi.fn(() =>
    Effect.acquireRelease(Effect.succeed(connection), () => Effect.sync(closeConnection)),
  );
  const dependencies = Layer.mergeAll(
    Layer.mock(PreviewAutomationBroker)({ invoke }),
    Layer.mock(ProviderSessionManagerV2)({ figmaMcpConnection: openConnection }),
    Layer.mock(ServerEnvironment)({ getEnvironmentId: Effect.succeed(environmentId) }),
    ServerConfig.layerTest(process.cwd(), { prefix: "tabs-figma-canvas-test-" }),
    NodeCrypto.layer,
  ).pipe(Layer.provideMerge(NodeServices.layer));
  const registration = McpHttpServer.layerPreviewToolkit as Layer.Layer<
    never,
    unknown,
    | McpServer.McpServer
    | PreviewAutomationBroker
    | ProviderSessionManagerV2
    | ServerConfig.ServerConfig
  >;
  const layer = registration.pipe(
    Layer.provideMerge(McpServer.McpServer.layer),
    Layer.provideMerge(Registry.layer),
    Layer.provideMerge(dependencies),
  );
  const setup = Effect.gen(function* () {
    const registry = yield* Registry.McpSessionRegistry;
    const server = yield* McpServer.McpServer;
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const session = (id: ThreadId) =>
      Effect.gen(function* () {
        const { config } = yield* registry.issue({
          threadId: id,
          providerInstanceId: ProviderInstanceId.make("codex"),
        });
        const scope = yield* registry.resolve(config.authorizationHeader.slice(7));
        if (!scope) throw new Error("Fixture credential is unavailable");
        return scope;
      });
    const origin = yield* session(threadId);
    const call = (scope: McpThreadInvocationScope = origin) =>
      server
        .callTool({
          name: "preview_figma_frame",
          arguments: {
            tabId: target.tabId,
            profileId: target.profileId,
            attachmentId: target.attachmentId,
            frame,
          },
        })
        .pipe(
          Effect.provideService(McpInvocationContext, scope),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
    return { call, origin, session, stateDir };
  });
  return {
    desktop,
    canvas,
    provider,
    whoami,
    useFigma,
    onBrowserRequest,
    openConnection,
    closeConnection,
    layer,
    setup,
  };
}

it("requires a current approval, then reconciles a lost write response without writing again", async () => {
  const fixture = makeFixture();
  await Effect.runPromise(
    Effect.gen(function* () {
      const { call, origin, session, stateDir } = yield* fixture.setup;
      const owner = { environmentId: origin.environmentId, threadId: origin.thread.threadId };
      fixture.desktop.attachmentOpen = false;
      expect((yield* call()).isError).toBe(true);
      expect(fixture.openConnection).not.toHaveBeenCalled();
      fixture.desktop.attachmentOpen = true;

      const needsApproval = yield* call();
      expect(needsApproval.isError).toBe(false);
      expect(fixture.closeConnection).toHaveBeenCalledTimes(1);
      expect(needsApproval.structuredContent).toMatchObject({ status: "approval_required" });
      const { operationId } = Schema.decodeUnknownSync(FigmaCanvasResultRef)(
        needsApproval.structuredContent,
      );
      const journal = () => figmaCanvasJournal(stateDir, operationId);
      expect(fixture.useFigma).not.toHaveBeenCalled();
      expect(yield* Effect.promise(() => journal().state(owner))).toBeUndefined();

      fixture.desktop.status = "approved";
      const stale = yield* call();
      expect(stale.isError).toBe(true);
      expect(stale.content).toEqual([
        { type: "text", text: expect.stringContaining("Request a fresh Figma approval") },
      ]);
      expect(fixture.onBrowserRequest).toHaveBeenLastCalledWith({
        action: "dispatch",
        approval: { id: "22222222-2222-4222-8222-222222222222", target, operationId, email, frame },
      });
      expect(fixture.useFigma).not.toHaveBeenCalled();
      expect(yield* Effect.promise(() => journal().state(owner))).toBeUndefined();

      fixture.desktop.status = "approved";
      fixture.desktop.dispatchAllowed = true;
      const lost = yield* call();
      expect(lost.isError).toBe(false);
      expect(lost.structuredContent).toMatchObject({ status: "uncertain", operationId });
      const scriptInput = { ...frame, parentNodeId: target.nodeId, operationId };
      const connectionArgs = { fileKey: "active-branch", editorType: "figma" };
      expect(fixture.useFigma.mock.calls).toEqual([
        [
          {
            ...connectionArgs,
            skillNames: "figma-use,figma-generate-design",
            javascript: buildFigmaFrameScript(scriptInput),
          },
        ],
      ]);
      expect(yield* Effect.promise(() => journal().state(owner, email))).toEqual({
        target,
        receipt: undefined,
      });

      fixture.onBrowserRequest.mockClear();
      const recovered = yield* call();
      expect(recovered.isError).toBe(false);
      expect(recovered.structuredContent).toEqual({
        status: "verified",
        operationId,
        ...nodeIds,
        verifiedAt: expect.any(String),
      });
      expect(fixture.onBrowserRequest.mock.calls.map(([request]) => request.action)).toEqual([
        "inspect",
        "inspect",
        "inspect",
      ]);
      expect(fixture.useFigma).toHaveBeenCalledTimes(2);
      expect(fixture.useFigma).toHaveBeenLastCalledWith({
        ...connectionArgs,
        skillNames: "figma-use",
        javascript: buildFigmaFrameProbe(scriptInput),
      });
      const saved = yield* Effect.promise(() => journal().state(owner));
      expect(saved?.receipt).toEqual({
        target,
        ...nodeIds,
        verifiedAt: Schema.decodeUnknownSync(Schema.Struct({ verifiedAt: Schema.String }))(
          recovered.structuredContent,
        ).verifiedAt,
      });
      expect((yield* call()).structuredContent).toEqual(recovered.structuredContent);
      expect(fixture.useFigma).toHaveBeenCalledTimes(3);

      fixture.canvas.frameExists = false;
      const deleted = yield* call();
      expect(deleted.structuredContent).toMatchObject({ status: "uncertain", operationId });
      fixture.useFigma.mockReturnValueOnce(
        Effect.succeed({
          structuredContent: {
            status: "existing",
            parentNodeId: target.nodeId,
            frameNodeId: "21:20",
            textNodeId: "21:21",
          },
        }),
      );
      const replaced = yield* call();
      expect(replaced.structuredContent).toMatchObject({ status: "uncertain", operationId });
      expect(yield* Effect.promise(() => journal().state(owner))).toEqual(saved);

      const other = yield* session(ThreadId.make("figma-other-thread"));
      expect((yield* call(other)).isError).toBe(true);
      yield* Effect.promise(() =>
        expect(
          journal().state({ environmentId: other.environmentId, threadId: other.thread.threadId }),
        ).rejects.toThrow("approved account and thread"),
      );
      expect(fixture.useFigma).toHaveBeenCalledTimes(5);
      expect(
        fixture.useFigma.mock.calls.filter(
          ([args]) => args.skillNames === "figma-use,figma-generate-design",
        ),
      ).toHaveLength(1);
    }).pipe(Effect.provide(fixture.layer)),
  );
});

it("withholds an interrupted Figma verification and recovers with a later read", async () => {
  const fixture = makeFixture();
  fixture.desktop.status = "approved";
  fixture.desktop.dispatchAllowed = true;
  await Effect.runPromise(
    Effect.gen(function* () {
      const { call, origin, stateDir } = yield* fixture.setup;
      const owner = { environmentId: origin.environmentId, threadId: origin.thread.threadId };
      const lost = yield* call();
      const { operationId } = Schema.decodeUnknownSync(FigmaCanvasResultRef)(
        lost.structuredContent,
      );
      expect(lost.structuredContent).toMatchObject({ status: "uncertain", operationId });
      const journal = figmaCanvasJournal(stateDir, operationId);
      fixture.useFigma.mockReturnValueOnce(
        Effect.sync(() => {
          fixture.desktop.attachmentOpen = false;
          return {
            structuredContent: { status: "existing", parentNodeId: target.nodeId, ...nodeIds },
          };
        }),
      );
      const interrupted = yield* call();
      expect(interrupted.structuredContent).toMatchObject({ status: "uncertain", operationId });
      expect((yield* Effect.promise(() => journal.state(owner)))?.receipt).toBeUndefined();

      fixture.desktop.attachmentOpen = true;
      const [recovered, concurrent] = yield* Effect.all([call(), call()], { concurrency: 2 });
      expect(recovered.structuredContent).toMatchObject({
        status: "verified",
        operationId,
        ...nodeIds,
      });
      expect(concurrent.structuredContent).toEqual(recovered.structuredContent);
      expect(fixture.useFigma.mock.calls.map(([args]) => args.skillNames)).toEqual([
        "figma-use,figma-generate-design",
        "figma-use",
        "figma-use",
        "figma-use",
      ]);
    }).pipe(Effect.provide(fixture.layer)),
  );
});

it("requires an exact approval and withholds a receipt until the approved parent is verified", async () => {
  const fixture = makeFixture();
  await Effect.runPromise(
    Effect.gen(function* () {
      const { call, origin, stateDir } = yield* fixture.setup;
      const preview = yield* call();
      const { operationId } = Schema.decodeUnknownSync(FigmaCanvasResultRef)(
        preview.structuredContent,
      );
      const owner = { environmentId: origin.environmentId, threadId: origin.thread.threadId };
      const journal = figmaCanvasJournal(stateDir, operationId);
      const approval = {
        id: "22222222-2222-4222-8222-222222222222",
        operationId,
        target,
        email,
        frame,
      };
      fixture.desktop.status = "approved";
      fixture.desktop.dispatchAllowed = true;
      for (const changed of [
        { ...approval, email: "other@example.test" },
        { ...approval, target: { ...target, nodeId: "21:70" } },
      ]) {
        fixture.onBrowserRequest
          .mockReturnValueOnce(target)
          .mockReturnValueOnce({ status: "approved", approval: changed });
        const rejected = yield* call();
        expect(rejected.isError).toBe(true);
        expect(rejected.content).toEqual([
          { type: "text", text: expect.stringContaining("different Figma frame or account") },
        ]);
      }
      expect(fixture.onBrowserRequest.mock.calls.map(([request]) => request.action)).not.toContain(
        "dispatch",
      );
      expect(fixture.useFigma).not.toHaveBeenCalled();
      expect(yield* Effect.promise(() => journal.state(owner))).toBeUndefined();

      fixture.useFigma
        .mockReturnValueOnce(
          Effect.sync(() => {
            fixture.canvas.frameExists = true;
            return {
              structuredContent: { status: "created", parentNodeId: target.nodeId, ...nodeIds },
            };
          }),
        )
        .mockReturnValueOnce(
          Effect.succeed({
            structuredContent: { status: "existing", parentNodeId: "21:70", ...nodeIds },
          }),
        );
      const wrongParent = yield* call();
      expect(wrongParent.structuredContent).toMatchObject({ status: "uncertain", operationId });
      expect((yield* Effect.promise(() => journal.state(owner)))?.receipt).toBeUndefined();

      const verified = yield* call();
      expect(verified.structuredContent).toMatchObject({
        status: "verified",
        operationId,
        ...nodeIds,
      });
      expect((yield* Effect.promise(() => journal.state(owner)))?.receipt).toMatchObject({
        target,
        ...nodeIds,
      });
      expect(fixture.useFigma.mock.calls.map(([args]) => args.skillNames)).toEqual([
        "figma-use,figma-generate-design",
        "figma-use",
        "figma-use",
      ]);
    }).pipe(Effect.provide(fixture.layer)),
  );
});

it.each([
  ["a rogue MCP origin", "official remote Figma server"],
  ["a changed whoami account", "signed-in Figma account changed"],
  ["an incompatible JSON schema", "changed its tool arguments"],
] as const)("fails closed before dispatch with %s", async (scenario, message) => {
  const fixture = makeFixture();
  fixture.desktop.status = "approved";
  fixture.desktop.dispatchAllowed = true;
  if (scenario === "a rogue MCP origin") fixture.provider.origin = "https://rogue.example.test";
  if (scenario === "a changed whoami account") {
    fixture.whoami
      .mockReturnValueOnce(email)
      .mockReturnValueOnce(email)
      .mockReturnValue("other@example.test");
  }
  if (scenario === "an incompatible JSON schema") fixture.provider.requiredExtraArgument = true;

  await Effect.runPromise(
    Effect.gen(function* () {
      const { call } = yield* fixture.setup;
      const result = yield* call();
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: "text", text: expect.stringContaining(message) }]);
      expect(fixture.useFigma).not.toHaveBeenCalled();
      expect(fixture.onBrowserRequest.mock.calls.map(([request]) => request.action)).not.toContain(
        "dispatch",
      );
    }).pipe(Effect.provide(fixture.layer)),
  );
});
