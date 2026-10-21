// @effect-diagnostics nodeBuiltinImport:off
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { guardHttpResponseWriteErrors } from "./httpResponseErrorGuard.ts";

const servers: NodeHttp.Server[] = [];

function listen(server: NodeHttp.Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as NodeNet.AddressInfo).port);
    });
  });
}

function fetchStatus(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = NodeHttp.get({ host: "127.0.0.1", port, path }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on("error", reject);
    request.setTimeout(5_000, () => reject(new Error("request timed out")));
  });
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

describe("guardHttpResponseWriteErrors", () => {
  it("bounds requests when application routes never attach", async () => {
    const server = guardHttpResponseWriteErrors(NodeHttp.createServer(), undefined, {
      startupWaitMs: 10,
    });
    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
      method: "POST",
      body: "bootstrap=test",
      signal: AbortSignal.timeout(2_000),
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await response.text();

    server.on("request", (_request, response) => {
      response.writeHead(200);
      response.end("ready");
    });
    await expect(fetchStatus(port, "/")).resolves.toBe(200);
  });

  it("delivers early requests to the eventual handler with their body and normal CORS policy", async () => {
    const server = guardHttpResponseWriteErrors(NodeHttp.createServer());
    const port = await listen(server);
    const pending = fetch(`http://127.0.0.1:${port}/oauth/token`, {
      method: "POST",
      body: "bootstrap=test",
      headers: { Origin: "http://localhost:5733" },
      signal: AbortSignal.timeout(2_000),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    server.on("request", (request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        response.writeHead(200, { "Access-Control-Allow-Origin": "http://localhost:5733" });
        response.end(body);
      });
    });
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5733");
    expect(await response.text()).toBe("bootstrap=test");
  });

  it("bounds the startup queue and releases its requests as routes attach", async () => {
    const server = guardHttpResponseWriteErrors(NodeHttp.createServer(), undefined, {
      maxPendingRequests: 1,
    });
    const port = await listen(server);
    const received = new Promise<void>((resolve) => {
      server.once("connection", (socket) => socket.once("data", () => setImmediate(resolve)));
    });
    const first = fetchStatus(port, "/first");
    await received;
    await expect(fetchStatus(port, "/overflow")).resolves.toBe(503);
    server.on("request", (_request, response) => {
      response.writeHead(200);
      response.end();
    });
    await expect(first).resolves.toBe(200);
  });

  it("removes a disconnected startup request without retaining its queue slot", async () => {
    const server = guardHttpResponseWriteErrors(NodeHttp.createServer(), undefined, {
      maxPendingRequests: 1,
    });
    const port = await listen(server);
    let disconnect!: () => void;
    const received = new Promise<void>((resolve) => {
      server.once("connection", (socket) => {
        disconnect = () => socket.destroy();
        socket.once("data", () => setImmediate(resolve));
      });
    });
    const first = fetchStatus(port, "/cancelled").catch(() => undefined);
    await received;
    disconnect();
    await first;
    const next = fetchStatus(port, "/next");
    await new Promise((resolve) => setTimeout(resolve, 20));
    server.on("request", (_request, response) => {
      response.writeHead(200);
      response.end();
    });
    await expect(next).resolves.toBe(200);
  });

  it("contains an upgrade socket write failure instead of crashing the process", async () => {
    const writeErrors: unknown[] = [];
    const failureObserved = Promise.withResolvers<void>();
    const server = guardHttpResponseWriteErrors(NodeHttp.createServer(), (error) => {
      writeErrors.push(error);
      failureObserved.resolve();
    });

    server.on("upgrade", (_request, socket) => {
      // Simulate the client vanishing while the auth rejection response is
      // written to the upgrade socket: the write failure surfaces as an
      // "error" event on a socket Node's http server no longer listens to.
      socket.destroy(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    });

    const port = await listen(server);

    const client = NodeNet.connect(port, "127.0.0.1", () => {
      client.write(
        [
          "GET /rpc HTTP/1.1",
          "Host: 127.0.0.1",
          "Connection: Upgrade",
          "Upgrade: websocket",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n"),
      );
    });
    client.on("error", () => {});

    await failureObserved.promise;
    client.destroy();

    expect(writeErrors).toHaveLength(1);
    expect(writeErrors[0]).toBeInstanceOf(Error);
    expect((writeErrors[0] as NodeJS.ErrnoException).code).toBe("EPIPE");

    // The process survived the failed write and the server keeps serving.
    server.on("request", (_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    });
    await expect(fetchStatus(port, "/")).resolves.toBe(200);
  });

  it("arms every response with an error listener without disturbing normal traffic", async () => {
    const writeErrors: unknown[] = [];
    let responseErrorListeners = -1;
    const server = guardHttpResponseWriteErrors(NodeHttp.createServer(), (error) => {
      writeErrors.push(error);
    });

    server.on("request", (_request, response) => {
      responseErrorListeners = response.listenerCount("error");
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    });

    const port = await listen(server);

    await expect(fetchStatus(port, "/")).resolves.toBe(200);
    expect(responseErrorListeners).toBeGreaterThan(0);
    expect(writeErrors).toEqual([]);
  });
});
