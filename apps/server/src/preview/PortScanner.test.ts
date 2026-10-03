import { describe, expect, it } from "vitest";
import * as NodeNet from "node:net";
import {
  CONFIGURED_LOCAL_SERVER_URLS_MAX_ITEMS,
  PREVIEW_URL_MAX_LENGTH,
  type DiscoveredLocalServer,
} from "@tabs/contracts";
import { HostProcessPlatform } from "@tabs/shared/hostProcess";
import * as Net from "@tabs/shared/Net";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { FetchHttpClient } from "effect/unstable/http";

import * as PortScanner from "./PortScanner";

describe("PortScanner parsing", () => {
  it("parses lsof output correctly", () => {
    const rawLsof = [
      "p1234",
      "cnode",
      "n*:5173",
      "n127.0.0.1:3000",
      "p5678",
      "cpython",
      "n[::1]:8000",
    ].join("\n");

    const terminalMap = new Map([[1234, { threadId: "thread-1" as any, terminalId: "term-1" }]]);

    const servers = PortScanner.parseLsofOutput(rawLsof, terminalMap);
    expect(servers).toHaveLength(3);
    expect(servers[0]).toEqual({
      host: "localhost",
      port: 3000,
      url: "http://localhost:3000",
      processName: "node",
      pid: 1234,
      terminal: { threadId: "thread-1", terminalId: "term-1" },
    });
    expect(servers[1]?.port).toBe(5173);
    expect(servers[1]?.terminal).toEqual({ threadId: "thread-1", terminalId: "term-1" });
    expect(servers[2]?.port).toBe(8000);
    expect(servers[2]?.terminal).toBeNull();
  });

  it("parses windows listener output correctly", () => {
    const rawWindows = [
      "127.0.0.1|3000|1234|node",
      "0.0.0.0|5173|5678|vite",
      "::|8080|9999|java",
      "192.168.1.50|9999|1111|other",
    ].join("\n");

    const servers = PortScanner.parseWindowsListenerOutput(rawWindows);
    expect(servers).toHaveLength(3);
    expect(servers.map((s) => s.port)).toEqual([3000, 5173, 8080]);
    expect(servers[0]?.processName).toBe("node");
    expect(servers[1]?.processName).toBe("vite");
  });

  it("filters non-local or invalid lsof ports", () => {
    expect(PortScanner.parsePortFromLsofName("*:5173")).toBe(5173);
    expect(PortScanner.parsePortFromLsofName("127.0.0.1:3000")).toBe(3000);
    expect(PortScanner.parsePortFromLsofName("localhost:8080")).toBe(8080);
    expect(PortScanner.parsePortFromLsofName("[::1]:4000")).toBe(4000);
    expect(PortScanner.parsePortFromLsofName("192.168.1.1:8000")).toBeNull();
    expect(PortScanner.parsePortFromLsofName("*:invalid")).toBeNull();
    expect(PortScanner.parsePortFromLsofName("")).toBeNull();
  });
});

describe("PortDiscovery Service", () => {
  it("scans and discovers servers with web probing", async () => {
    const mockFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("5173")) {
        return new Response("<!DOCTYPE html><html><body>App</body></html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return new Response("Not Found", { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const mockProcessRunner = Layer.succeed(PortScanner.PortDiscoveryProcessRunner, {
      run: () =>
        Effect.succeed({
          stdout: "p1234\ncnode\nn*:5173\np5678\ncother\nn*:9999\n",
          stderr: "",
        }),
    });

    const mockNet = Layer.succeed(Net.NetService, {
      canListenOnHost: () => Effect.succeed(true),
      isPortAvailableOnLoopback: () => Effect.succeed(true),
      hasListenerOnHost: () => Effect.succeed(false),
      reserveLoopbackPort: () => Effect.succeed(40_000),
      findAvailablePort: (preferred) => Effect.succeed(preferred),
    });

    const testLayer = Layer.effect(PortScanner.PortDiscovery, PortScanner.make).pipe(
      Layer.provide(
        Layer.mergeAll(
          mockProcessRunner,
          mockNet,
          Layer.succeed(HostProcessPlatform, "darwin"),
          FetchHttpClient.layer.pipe(
            Layer.provide(Layer.succeed(FetchHttpClient.Fetch, mockFetch)),
          ),
        ),
      ),
    );

    const program = Effect.gen(function* () {
      const discovery = yield* PortScanner.PortDiscovery;
      return yield* discovery.scan();
    }).pipe(Effect.scoped, Effect.provide(testLayer));

    const result = await Effect.runPromise(program);
    expect(result).toHaveLength(1);
    expect(result[0]?.port).toBe(5173);
    expect(result[0]?.url).toBe("http://localhost:5173");
  });
});
