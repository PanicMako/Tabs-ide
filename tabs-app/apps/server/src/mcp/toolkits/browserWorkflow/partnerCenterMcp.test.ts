import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthSessionId,
  BrowserWorkflowBrowserRequest,
  BrowserWorkflowReport,
  EnvironmentId,
  PartnerCenterStatusRef,
  PartnerCenterStatusRequest,
  PreviewTabId,
  ProviderInstanceId,
  ThreadId,
  type BrowserWorkflowDefinition,
} from "@tabs/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { McpSchema, McpServer } from "effect/unstable/ai";
import { expect, it, vi } from "vitest";

import { ServerSecretStore } from "../../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../../config.ts";
import { ServerEnvironment } from "../../../environment/ServerEnvironment.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";
import * as Registry from "../../McpSessionRegistry.ts";
import * as Broker from "../../PreviewAutomationBroker.ts";
import { writePartnerCenterConnection } from "./partnerCenterConnection.ts";

it.each(["submitted", "ready_to_upload"] as const)(
  "reads the exact Store draft saved at %s after separate desktop consent in the authenticated thread",
  async (browserStage) => {
    const environmentId = EnvironmentId.make("partner-center-environment");
    const threadId = ThreadId.make("partner-center-thread");
    const target = {
      tabId: PreviewTabId.make("agents-surface-store"),
      projectId: "partner-center-project",
      profileId: "work",
      hostKey: "desktop-work",
    };
    const redactedUrl = "https://partner.microsoft.com/dashboard/drafts/457";
    const definition: BrowserWorkflowDefinition = {
      url: redactedUrl + "?view=private-draft#private-editor",
      resourceId: "457",
      identitySelector: "#draft-id",
      statusSelector: "#status",
      ...(browserStage === "submitted"
        ? { readOnly: true, states: { submitted: "Submitted" } }
        : {
            states: {
              ready_to_upload: "Ready to upload",
              uploaded: "Uploaded",
              submitted: "Submitted",
              certified: "Certified",
              published: "Published",
            },
            uploadSelector: "#upload",
            submitSelector: "#submit",
            breakpoint: {
              selector: "#consequence",
              clearText: "Create build",
              pauseText: "Replace build",
            },
          }),
    };
    const redactedDefinition = { ...definition, url: redactedUrl };
    const registration = {
      tenantId: "11111111-1111-4111-8111-111111111111",
      clientId: "22222222-2222-4222-8222-222222222222",
      clientSecret: "private-entra-secret",
    };
    const applicationId = "9WZDNCRFJ3PZ";
    let bytes: Uint8Array | undefined;
    let consentAvailable = false;
    let consumed = false;
    let approvedApplication = applicationId;
    let lookupChecks = 0;
    let revokeAtCheck: number | undefined;
    const approvalId = "33333333-3333-4333-8333-333333333333";
    const lookup = vi.fn((request: PartnerCenterStatusRequest) => {
      expect(request.target).toEqual(target);
      expect(request.definition).toEqual(definition);
      let approved: boolean;
      if (request.verifyApprovalId !== undefined) {
        expect(request.verifyApprovalId).toBe(approvalId);
        lookupChecks++;
        approved = consumed && lookupChecks !== revokeAtCheck;
      } else {
        approved = consentAvailable;
        consumed = approved;
        consentAvailable = false;
      }
      return {
        status: approved ? "approved" : "approval_required",
        approval: {
          id: approvalId,
          workflowId: request.workflowId,
          applicationId: approvedApplication,
          submissionId: definition.resourceId,
          tenantId: request.tenantId,
          clientId: request.clientId,
        },
      };
    });
    const fetch = vi.fn(async (_url: string, init: RequestInit) =>
      init.method === "POST"
        ? Response.json({ access_token: "fake-test-token" })
        : Response.json({ id: "457", status: "Published", fileUploadUrl: "private-upload-url" }),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      const dependencies = Layer.mergeAll(
        Layer.mock(ServerSecretStore)({
          get: () => Effect.sync(() => Option.fromNullishOr(bytes)),
          set: (_name, value) =>
            Effect.sync(() => {
              bytes = value;
            }),
        }),
        Broker.layer,
        Layer.mock(ServerEnvironment)({ getEnvironmentId: Effect.succeed(environmentId) }),
        ServerConfig.layerTest(process.cwd(), { prefix: "tabs-partner-center-test-" }),
        NodeCrypto.layer,
      ).pipe(Layer.provideMerge(NodeServices.layer));
      const registrationLayer = McpHttpServer.layerPreviewToolkit as Layer.Layer<
        never,
        unknown,
        | McpServer.McpServer
        | Broker.PreviewAutomationBroker
        | ServerConfig.ServerConfig
        | ServerSecretStore
      >;
      const mcpLayer = registrationLayer.pipe(
        Layer.provideMerge(McpServer.McpServer.layer),
        Layer.provideMerge(Registry.layer),
        Layer.provideMerge(dependencies),
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* Registry.McpSessionRegistry;
          const server = yield* McpServer.McpServer;
          const broker = yield* Broker.PreviewAutomationBroker;
          const wrongHost = vi.fn();
          const connect = (profile: "work" | "personal") =>
            Effect.gen(function* () {
              const clientId = `fixture-${profile}`;
              const desktopSession = AuthSessionId.make(clientId);
              const ready = yield* Deferred.make<void>();
              const stream = yield* broker.connect(
                {
                  clientId,
                  environmentId,
                  supportedOperations: ["browserWorkflow", "partnerCenterStatus"],
                },
                desktopSession,
              );
              yield* Stream.runForEach(stream, (event) =>
                Effect.gen(function* () {
                  if (event.type === "connected") {
                    yield* broker.focusHost(
                      {
                        clientId,
                        connectionId: event.connectionId,
                        environmentId,
                        focused: profile === "personal",
                        liveTabs: [
                          { threadId, tabId: target.tabId, workflowHostKey: `desktop-${profile}` },
                        ],
                      },
                      desktopSession,
                    );
                    yield* Deferred.succeed(ready, undefined);
                    return;
                  }
                  const { request } = event;
                  const response = {
                    clientId,
                    connectionId: event.connectionId,
                    requestId: request.requestId,
                  };
                  if (profile === "personal") {
                    wrongHost(request.operation);
                    yield* broker.respond({ ...response, ok: false }, desktopSession);
                    return;
                  }
                  expect(request).toMatchObject({
                    threadId,
                    tabId: target.tabId,
                    tabIdExplicit: true,
                  });
                  expect(JSON.stringify(request.input)).not.toContain(registration.clientSecret);
                  let result: unknown;
                  if (request.operation === "browserWorkflow") {
                    const input = Schema.decodeUnknownSync(BrowserWorkflowBrowserRequest)(
                      request.input,
                    );
                    expect(input).toEqual({
                      phase: "inspect",
                      profileId: target.profileId,
                      definition: redactedDefinition,
                    });
                    result = {
                      disposition: "observed",
                      target,
                      resolvedDraftUrl: definition.url,
                      observation: {
                        stage: browserStage,
                        statusText: definition.states[browserStage],
                        breakpoint: "irrelevant",
                        submitAvailable: false,
                      },
                    };
                  } else {
                    expect(request.operation).toBe("partnerCenterStatus");
                    result = lookup(
                      Schema.decodeUnknownSync(PartnerCenterStatusRequest)(request.input),
                    );
                  }
                  yield* broker.respond({ ...response, ok: true, result }, desktopSession);
                }),
              ).pipe(Effect.forkScoped);
              yield* Deferred.await(ready);
            });
          yield* connect("work");
          const providerInstanceId = ProviderInstanceId.make("codex");
          const session = (id: ThreadId) =>
            Effect.gen(function* () {
              const { config } = yield* registry.issue({ threadId: id, providerInstanceId });
              const scope = yield* registry.resolve(config.authorizationHeader.slice(7));
              if (!scope) throw new Error("Fixture credential is unavailable");
              return scope;
            });
          const origin = yield* session(threadId);
          const other = yield* session(ThreadId.make("personal-thread"));
          const callTool = (name: string, args: Record<string, unknown>, scope = origin) =>
            server.callTool({ name, arguments: args }).pipe(
              Effect.provideService(McpInvocationContext, scope),
              Effect.provideService(
                McpSchema.McpServerClient,
                McpSchema.McpServerClient.of({
                  clientId: 1,
                  protocolVersion: "2025-06-18",
                  clientCapabilities: {},
                  clientInfo: { name: "store-status-test", version: "1.0" },
                  initializePayload: {
                    protocolVersion: "2025-06-18",
                    capabilities: {},
                    clientInfo: { name: "store-status-test", version: "1.0" },
                  },
                  getClient: Effect.die("unused"),
                }),
              ),
            );
          const armed = yield* callTool("preview_workflow", {
            action: "arm",
            tabId: target.tabId,
            profileId: target.profileId,
            definition: redactedDefinition,
          });
          expect(armed.isError, JSON.stringify(armed.content)).toBe(false);
          expect(JSON.stringify(armed)).not.toMatch(/private-draft|private-editor/);
          const {
            workflowId,
            phase,
            result: location,
          } = Schema.decodeUnknownSync(BrowserWorkflowReport)(armed.structuredContent);
          expect(location.url).toBe(redactedUrl);
          if (browserStage === "submitted") {
            expect(phase).toBe("verified");
            expect(location.readOnly).toBe(true);
          } else {
            expect(location).not.toHaveProperty("readOnly");
          }
          yield* connect("personal");
          const call = (scope = origin) =>
            callTool("preview_partner_center_status", { workflowId, applicationId }, scope);
          const missingConnection = yield* call();
          expect(missingConnection.isError).toBe(true);
          expect(JSON.stringify(missingConnection.content)).toContain("Connect Partner Center");
          yield* writePartnerCenterConnection(registration);
          expect((yield* call(other)).isError).toBe(true);
          expect(lookup).not.toHaveBeenCalled();
          const pending = yield* call();
          expect(pending.isError, JSON.stringify(pending.content)).toBe(false);
          expect(pending.structuredContent).toEqual({
            status: "approval_required",
            workflowId,
            applicationId,
            submissionId: definition.resourceId,
          });
          consentAvailable = true;
          approvedApplication = "OTHER-APP";
          const wrongApplication = yield* call();
          expect(wrongApplication.isError, JSON.stringify(wrongApplication.content)).toBe(true);
          expect(fetch).not.toHaveBeenCalled();
          approvedApplication = applicationId;
          consentAvailable = true;
          const result = yield* call();
          expect(result.isError).toBe(false);
          expect(result.structuredContent).toEqual({
            status: "verified",
            evidence: "connector",
            workflowId,
            browserStage,
            applicationId,
            submissionId: definition.resourceId,
            storeStatus: "Published",
            observedAt: expect.any(String),
          });
          expect(Schema.is(PartnerCenterStatusRef)(result.structuredContent)).toBe(true);
          expect(JSON.stringify(result)).not.toMatch(
            /private-upload-url|fake-test-token|private-entra-secret|private-draft|private-editor/,
          );
          expect(fetch.mock.calls.map(([url, init]) => [init.method, url])).toEqual([
            ["POST", `https://login.microsoftonline.com/${registration.tenantId}/oauth2/token`],
            [
              "GET",
              `https://manage.devcenter.microsoft.com/v1.0/my/applications/${applicationId}/submissions/${definition.resourceId}`,
            ],
          ]);
          expect(lookupChecks).toBe(2);
          expect((yield* call()).structuredContent).toEqual(pending.structuredContent);
          expect(fetch).toHaveBeenCalledTimes(2);

          fetch.mockClear();
          lookupChecks = 0;
          revokeAtCheck = 1;
          consentAvailable = true;
          const beforeRequest = yield* call();
          expect(beforeRequest.isError).toBe(true);
          expect(JSON.stringify(beforeRequest)).toContain("approved Store draft changed");
          expect(fetch.mock.calls.map(([, init]) => init.method)).toEqual(["POST"]);

          fetch.mockClear();
          lookupChecks = 0;
          revokeAtCheck = 2;
          consentAvailable = true;
          const afterRequest = yield* call();
          expect(afterRequest.isError).toBe(true);
          expect(JSON.stringify(afterRequest)).not.toMatch(/Published|fake-test-token/);
          expect(fetch.mock.calls.map(([, init]) => init.method)).toEqual(["POST", "GET"]);
          yield* registry.revokeProviderSession(origin.thread.providerSessionId);
          const lookupCount = lookup.mock.calls.length;
          const revoked = yield* call();
          expect(revoked.isError).toBe(true);
          expect(JSON.stringify(revoked.content)).toContain(
            "no longer owns the Partner Center lookup",
          );
          expect(lookup).toHaveBeenCalledTimes(lookupCount);
          expect(fetch).toHaveBeenCalledTimes(2);
          expect(wrongHost).not.toHaveBeenCalled();
        }).pipe(Effect.scoped, Effect.provide(mcpLayer)),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
