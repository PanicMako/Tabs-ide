import * as Http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { ExtensionAiBrokerClient } from "./ExtensionAiBrokerClient";

const token = "a".repeat(64);
let server: Http.Server | null = null;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

describe("ExtensionAiBrokerClient", () => {
  it("refuses non-loopback or credential-bearing endpoints", () => {
    for (const endpoint of [
      "https://example.com",
      "http://localhost:1234",
      "http://127.0.0.1:1234@evil.example",
      "http://127.0.0.1:1234/path",
    ]) {
      expect(() => new ExtensionAiBrokerClient({ endpoint, token })).toThrow();
    }
  });

  it("lists and invokes through the authenticated desktop channel", async () => {
    server = Http.createServer(async (request, response) => {
      expect(request.headers["x-tabs-extension-broker-token"]).toBe(token);
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      expect(body.projectId).toBe("project-a");
      response.setHeader("content-type", "application/json");
      response.end(
        request.url === "/tools"
          ? JSON.stringify({
              tools: [
                {
                  name: "tabs_ext_0123456789abcdef_sum",
                  extensionId: "acme.calc",
                  commandId: "sum",
                  description: "Sum",
                },
              ],
            })
          : JSON.stringify({ result: body.input }),
      );
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const client = new ExtensionAiBrokerClient({ endpoint, token });
    expect(await client.list("project-a")).toHaveLength(1);
    expect(await client.invoke("project-a", "tabs_ext_0123456789abcdef_sum", { a: 1 })).toEqual({
      a: 1,
    });
  });
});
