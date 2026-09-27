import * as Http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExtensionAiBrokerClient } from "./ExtensionAiBrokerClient.ts";
import { handleMcpHttpRequest } from "./McpHttpServer.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";

let server: Http.Server | null = null;
let client: Client | null = null;
afterEach(async () => {
  await client?.close();
  client = null;
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

describe("MCP extension AI tools", () => {
  it("lists and invokes only tools granted for the credential's current project", async () => {
    let projectId = "project-a";
    let granted = true;
    const name = "tabs_ext_0123456789abcdef_sum";
    const invoke = vi.fn(async (_projectId: string, _name: string, input: unknown) => input);
    const extensionAiBroker = {
      list: async (targetProjectId: string) =>
        granted && targetProjectId === "project-a"
          ? [{ name, extensionId: "acme.calc", commandId: "sum", description: "Add values" }]
          : [],
      invoke,
    } as unknown as ExtensionAiBrokerClient;
    server = Http.createServer((request, response) => {
      void handleMcpHttpRequest({
        request,
        response,
        scope: { threadId: "thread-a" } as McpInvocationScope,
        broker: { invoke: () => Effect.succeed({}) as never },
        extensionAiBroker,
        resolveProjectId: async () => projectId,
        runPromise: Effect.runPromise,
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
    client = new Client({ name: "tabs-extension-test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(url) as never);
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === name)).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "preview_status")).toBe(true);
    const result = await client.callTool({ name, arguments: { input: { first: 2, second: 3 } } });
    expect(result.isError).not.toBe(true);
    expect(invoke).toHaveBeenCalledWith("project-a", name, { first: 2, second: 3 });
    invoke.mockImplementationOnce(async () => {
      projectId = "project-b";
      return { privateResult: true };
    });
    const moved = await client.callTool({ name, arguments: { input: {} } });
    expect(moved.isError).toBe(true);
    expect(JSON.stringify(moved)).not.toContain("privateResult");
    projectId = "project-a";
    granted = false;
    const denied = await client.callTool({ name, arguments: { input: {} } });
    expect(denied.isError).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
    projectId = "project-b";
    expect((await client.listTools()).tools.some((tool) => tool.name === name)).toBe(false);
  });
});
