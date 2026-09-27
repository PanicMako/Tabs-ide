import { afterEach, describe, expect, it, vi } from "vitest";

import { ExtensionAiBrokerServer } from "./extensionAiBrokerServer";

const servers: ExtensionAiBrokerServer[] = [];
afterEach(() => {
  for (const server of servers) server.close();
  servers.length = 0;
});

describe("ExtensionAiBrokerServer", () => {
  it("requires a launch token and routes only the requested project", async () => {
    const invoke = vi.fn(async (_projectId: string, _name: string, input: unknown) => input);
    const server = new ExtensionAiBrokerServer({
      listAiToolsForProject: (projectId) =>
        projectId === "project-a"
          ? [
              {
                name: "tabs_ext_0123456789abcdef_sum",
                extensionId: "acme.calc",
                commandId: "sum",
                description: "Sum",
              },
            ]
          : [],
      invokeAiTool: invoke,
    });
    servers.push(server);
    const { endpoint, token } = await server.start();
    const unauthorized = await fetch(`${endpoint}/tools`, {
      method: "POST",
      body: JSON.stringify({ projectId: "project-a" }),
    });
    expect(unauthorized.status).toBe(401);
    const headers = { "X-Tabs-Extension-Broker-Token": token };
    const listed = await fetch(`${endpoint}/tools`, {
      method: "POST",
      headers,
      body: JSON.stringify({ projectId: "project-a" }),
    });
    expect((await listed.json()).tools).toEqual([
      expect.objectContaining({ name: "tabs_ext_0123456789abcdef_sum" }),
    ]);
    const other = await fetch(`${endpoint}/tools`, {
      method: "POST",
      headers,
      body: JSON.stringify({ projectId: "project-b" }),
    });
    expect((await other.json()).tools).toEqual([]);
    const invoked = await fetch(`${endpoint}/invoke`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        projectId: "project-a",
        toolName: "tabs_ext_0123456789abcdef_sum",
        input: { a: 2, b: 3 },
      }),
    });
    expect(await invoked.json()).toEqual({ result: { a: 2, b: 3 } });
    expect(invoke).toHaveBeenCalledWith("project-a", "tabs_ext_0123456789abcdef_sum", {
      a: 2,
      b: 3,
    });
    server.close();
    const rejected = await fetch(`${endpoint}/tools`, {
      method: "POST",
      headers,
      body: JSON.stringify({ projectId: "project-a" }),
    }).catch(() => null);
    expect(rejected?.status ?? null).not.toBe(200);
  });
});
