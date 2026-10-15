import { expect, it, vi } from "vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { makeMcpAuthMiddleware } from "./McpHttpServer.ts";
import { McpSessionRegistry } from "./McpSessionRegistry.ts";
import { ExtensionAiBrokerClient } from "./ExtensionAiBrokerClient.ts";
import { ServerConfig } from "../config.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
it("augments the authenticated middleware tool list using the current project", async () => {
  const name = "tabs_ext_0123456789abcdef_sum";
  const list = vi
    .spyOn(ExtensionAiBrokerClient.prototype, "list")
    .mockResolvedValue([{ name, extensionId: "acme.calc", commandId: "sum", description: "sum" }]);
  const invoke = vi
    .spyOn(ExtensionAiBrokerClient.prototype, "invoke")
    .mockResolvedValue({ sum: 3 });
  const services = Context.empty().pipe(
    Context.add(McpSessionRegistry, {
      resolve: (token: string) =>
        Effect.succeed(token === "valid" ? { thread: { threadId: "thread" } } : undefined),
    } as any),
    Context.add(ServerConfig, {
      desktopExtensionBroker: { endpoint: "http://127.0.0.1:43123", token: "a".repeat(64) },
    } as any),
    Context.add(ThreadManagementService, {
      getThreadShell: () => Effect.succeed({ projectId: "project", deletedAt: null }),
    } as any),
    Context.add(ProjectStoreV2, {
      get: () => Effect.succeed(Option.some({ projectId: "project" })),
    } as any),
  );
  try {
    const middleware = await Effect.runPromise(
      makeMcpAuthMiddleware.pipe(Effect.provideContext(services)),
    );
    const request = HttpServerRequest.fromWeb(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { authorization: "Bearer valid", "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }),
      }),
    );
    const response = await Effect.runPromise(
      middleware(
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({
            jsonrpc: "2.0",
            id: 7,
            result: { tools: [{ name: "native" }] },
          }),
        ),
      ).pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, request)),
    );
    const result = (await HttpServerResponse.toWeb(response).json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(result.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "native",
      name,
    ]);
    expect(list).toHaveBeenCalledWith("project");
    const callRequest = HttpServerRequest.fromWeb(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { authorization: "Bearer valid", "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 8,
          method: "tools/call",
          params: { name, arguments: { input: { a: 1 } } },
        }),
      }),
    );
    const called = await Effect.runPromise(
      middleware(Effect.die("native handler must not receive extension call")).pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, callRequest),
      ),
    );
    const callBody = (await HttpServerResponse.toWeb(called).json()) as {
      result: { content: Array<{ text: string }> };
    };
    expect(callBody.result.content[0]!.text).toBe('{"sum":3}');
    expect(invoke).toHaveBeenCalledWith("project", name, { a: 1 });
    const denied = await Effect.runPromise(
      middleware(Effect.die("unauthorized request reached handler")).pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(new Request("http://localhost/mcp")),
        ),
      ),
    );
    expect(denied.status).toBe(401);
  } finally {
    vi.restoreAllMocks();
  }
});
