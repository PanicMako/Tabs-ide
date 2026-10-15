import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@tabs/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as McpProtocol from "effect/unstable/ai/McpProtocol";
import { McpServer } from "effect/unstable/ai";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import * as Config from "../config.ts";
import * as Projects from "../orchestration-v2/ProjectStore.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as Registry from "./McpSessionRegistry.ts";
import * as McpHttpServer from "./McpHttpServer.ts";

it.effect(
  "serves project-scoped extension tools through the modern HTTP assembly and MCP SDK",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const name = "tabs_ext_0123456789abcdef_sum";
        const token = "a".repeat(64);
        let projectId = ProjectId.make("project-a");
        let granted = true;
        let moveDuringCall = false;
        let calls = 0;
        const broker = yield* Effect.acquireRelease(
          Effect.tryPromise(
            () =>
              new Promise<ReturnType<typeof createServer>>((resolve) => {
                const server = createServer(async (request, response) => {
                  if (request.headers["x-tabs-extension-broker-token"] !== token) {
                    response.writeHead(401).end();
                    return;
                  }
                  const chunks: Buffer[] = [];
                  for await (const chunk of request) chunks.push(Buffer.from(chunk));
                  const body = JSON.parse(Buffer.concat(chunks).toString());
                  response.setHeader("Content-Type", "application/json");
                  if (request.url === "/tools") {
                    response.end(
                      JSON.stringify({
                        tools:
                          granted && body.projectId === "project-a"
                            ? [
                                {
                                  name,
                                  extensionId: "acme.calc",
                                  commandId: "sum",
                                  description: "Add values",
                                },
                              ]
                            : [],
                      }),
                    );
                  } else {
                    calls++;
                    if (moveDuringCall) projectId = ProjectId.make("project-b");
                    response.end(
                      JSON.stringify({ result: { privateResult: true, input: body.input } }),
                    );
                  }
                });
                server.listen(0, "127.0.0.1", () => resolve(server));
              }),
          ),
          (server) =>
            Effect.promise(
              () =>
                new Promise<void>((resolve, reject) =>
                  server.close((error) => (error ? reject(error) : resolve())),
                ),
            ),
        );
        const now = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
        const threadId = ThreadId.make("thread-a");
        const shell = () =>
          Schema.decodeUnknownSync(OrchestrationV2ThreadShell)({
            id: threadId,
            projectId,
            title: "Thread",
            providerInstanceId: ProviderInstanceId.make("codex"),
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            activeProviderThreadId: null,
            lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
            forkedFrom: null,
            createdBy: "user",
            creationSource: "web",
            activeRunId: null,
            latestRunId: null,
            status: "idle",
            pendingRuntimeRequest: null,
            latestVisibleMessage: null,
            latestUserMessageAt: null,
            hasActionableProposedPlan: false,
            itemCount: 0,
            visibleItemCount: 0,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            deletedAt: null,
          });
        const auth = HttpRouter.middleware<{
          provides: import("./McpInvocationContext.ts").McpInvocationContext;
        }>()(McpHttpServer.makeMcpAuthMiddleware).layer;
        const routes = McpServer.layerHttp({
          protocols: [McpProtocol.v2025_06_18],
          name: "Tabs",
          version: "test",
          path: "/mcp",
        }).pipe(
          Layer.provide(auth),
          Layer.provide(
            Layer.mock(Registry.McpSessionRegistry)({
              resolve: (raw) =>
                Effect.succeed(
                  raw === "provider-test-token"
                    ? {
                        environmentId: EnvironmentId.make("environment-test"),
                        requestNamespace: "test-session",
                        issuedAt: 0,
                        client: undefined,
                        thread: {
                          threadId,
                          providerSessionId: "session",
                          providerInstanceId: ProviderInstanceId.make("codex"),
                        },
                        capabilities: new Set(["orchestration"] as const),
                      }
                    : undefined,
                ),
            }),
          ),
          Layer.provide(
            Layer.mock(Threads.ThreadManagementService)({
              getThreadShell: () => Effect.sync(shell),
            }),
          ),
          Layer.provide(
            Layer.mock(Projects.ProjectStoreV2)({
              get: (id) =>
                Effect.succeed(
                  Option.some({
                    projectId: id,
                    title: "Project",
                    workspaceRoot: "/workspace",
                    defaultModelSelection: null,
                    defaultThreadEnvMode: null,
                    autoPull: false,
                    faviconPath: null,
                    projectIcon: null,
                    scripts: [],
                    createdAt: "2026-01-01T00:00:00Z",
                    updatedAt: "2026-01-01T00:00:00Z",
                    deletedAt: null,
                  }),
                ),
            }),
          ),
          Layer.provide(
            Layer.effect(Config.ServerConfig)(
              Effect.map(Config.ServerConfig, (config) => ({
                ...config,
                desktopExtensionBroker: {
                  endpoint: `http://127.0.0.1:${(broker.address() as AddressInfo).port}`,
                  token,
                },
              })),
            ).pipe(
              Layer.provide(Config.layerTest(process.cwd(), { prefix: "tabs-modern-mcp-" })),
              Layer.provide(NodeServices.layer),
            ),
          ),
        );
        yield* HttpRouter.serve(routes, { disableListenLog: true, disableLogger: true }).pipe(
          Layer.build,
        );
        const server = yield* HttpServer.HttpServer;
        if (server.address._tag !== "TcpAddress") throw new Error("Expected TCP HTTP server");
        const client = yield* Effect.acquireRelease(
          Effect.sync(() => new Client({ name: "tabs-modern-test", version: "1.0.0" })),
          (client) => Effect.promise(() => client.close()),
        );
        const url = new URL(`http://127.0.0.1:${server.address.port}/mcp`);
        yield* Effect.tryPromise(() =>
          client.connect(
            new StreamableHTTPClientTransport(url, {
              requestInit: { headers: { Authorization: "Bearer provider-test-token" } },
            }) as Parameters<Client["connect"]>[0],
          ),
        );
        const list = () => Effect.tryPromise(() => client.listTools());
        expect((yield* list()).tools.some((tool) => tool.name === name)).toBe(true);
        const result = yield* Effect.tryPromise(() =>
          client.callTool({ name, arguments: { input: { first: 2 } } }),
        );
        expect(result.isError).not.toBe(true);
        expect(calls).toBe(1);
        moveDuringCall = true;
        const moved = yield* Effect.tryPromise(() =>
          client.callTool({ name, arguments: { input: {} } }),
        );
        expect(moved.isError).toBe(true);
        expect(JSON.stringify(moved)).not.toContain("privateResult");
        expect((yield* list()).tools.some((tool) => tool.name === name)).toBe(false);
        projectId = ProjectId.make("project-a");
        granted = false;
        const denied = yield* Effect.tryPromise(() =>
          client.callTool({ name, arguments: { input: {} } }),
        );
        expect(denied.isError).toBe(true);
        expect(calls).toBe(2);
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerTest), Effect.timeout("15 seconds")),
);
