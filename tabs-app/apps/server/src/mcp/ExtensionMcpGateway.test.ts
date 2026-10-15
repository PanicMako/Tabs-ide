import { expect, it, vi } from "vitest";
import {
  extensionMcpTools,
  invokeExtensionMcpTool,
  appendExtensionTools,
} from "./ExtensionMcpGateway.ts";
import type { ExtensionAiBrokerClient } from "./ExtensionAiBrokerClient.ts";
it("rejects revoked tools and suppresses results after project changes", async () => {
  let project = "a";
  let granted = true;
  const invoke = vi.fn(async () => {
    project = "b";
    return "secret";
  });
  const gateway = {
    resolveProjectId: async () => project,
    broker: {
      list: async () =>
        granted ? [{ name: "tabs_ext_0123456789abcdef_sum", description: "sum" }] : [],
      invoke,
    } as unknown as ExtensionAiBrokerClient,
  };
  expect(await extensionMcpTools(gateway)).toHaveLength(1);
  granted = false;
  await expect(
    invokeExtensionMcpTool(gateway, "tabs_ext_0123456789abcdef_sum", { input: {} }),
  ).rejects.toThrow("unavailable");
  expect(invoke).not.toHaveBeenCalled();
  granted = true;
  await expect(
    invokeExtensionMcpTool(gateway, "tabs_ext_0123456789abcdef_sum", { input: {} }),
  ).rejects.toThrow("changed during");
});

it("augments JSON and SSE tool lists without replacing native tools or IDs", () => {
  const payload = { jsonrpc: "2.0", id: 7, result: { tools: [{ name: "native" }] } };
  for (const sse of [false, true]) {
    const text = JSON.stringify(payload);
    const result = appendExtensionTools(
      sse ? `event: message\ndata: ${text}\n\n` : text,
      sse ? "text/event-stream" : "application/json",
      [{ name: "extension" }],
    );
    const decoded = JSON.parse(sse ? result.split("\n")[1]!.slice(6) : result);
    expect(decoded.id).toBe(7);
    expect(decoded.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "native",
      "extension",
    ]);
  }
});
