import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  extensionNetworkGetText,
  extensionNetworkStatusAllowed,
  resolveExtensionNetworkAddress,
  validateExtensionNetworkUrl,
  type ExtensionNetworkTransport,
} from "./extensionNetwork";

describe("extension network broker", () => {
  it("never follows or accepts redirects", () => {
    expect(extensionNetworkStatusAllowed(200)).toBe(true);
    expect(extensionNetworkStatusAllowed(302)).toBe(false);
    expect(extensionNetworkStatusAllowed(307)).toBe(false);
    expect(extensionNetworkStatusAllowed(401)).toBe(false);
  });
  it("accepts only declared HTTPS hosts without alternate authorities", () => {
    const hosts = ["api.example.com"];
    expect(validateExtensionNetworkUrl("https://api.example.com/data", hosts).hostname).toBe(
      "api.example.com",
    );
    for (const url of [
      "http://api.example.com/data",
      "https://api.example.com:444/data",
      "https://user:secret@api.example.com/data",
      "https://api.example.com.evil.test/data",
      "https://127.0.0.1/data",
      "https://api.example.com/data#fragment",
    ])
      expect(() => validateExtensionNetworkUrl(url, hosts)).toThrow();
  });

  it("rejects any private answer, including mixed and mapped IPv6 answers", async () => {
    const fake = (addresses: { address: string; family: 4 | 6 }[]) =>
      vi.fn().mockResolvedValue(addresses) as never;
    await expect(
      resolveExtensionNetworkAddress(
        "api.example.com",
        fake([
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ]),
      ),
    ).rejects.toThrow("restricted");
    await expect(
      resolveExtensionNetworkAddress(
        "api.example.com",
        fake([{ address: "::ffff:127.0.0.1", family: 6 }]),
      ),
    ).rejects.toThrow("restricted");
    await expect(
      resolveExtensionNetworkAddress("api.example.com", fake([{ address: "8.8.8.8", family: 4 }])),
    ).resolves.toEqual({ address: "8.8.8.8", family: 4 });
  });

  it("settles a stalled DNS lookup promptly on cancellation and at its deadline", async () => {
    const lookup = vi.fn(() => new Promise<never>(() => {})) as never;
    const controller = new AbortController();
    const cancelled = resolveExtensionNetworkAddress("api.example.com", lookup, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toThrow(/cancelled/);
    vi.useFakeTimers();
    try {
      const timedOut = resolveExtensionNetworkAddress("api.example.com", lookup);
      const assertion = expect(timedOut).rejects.toThrow(/lookup timed out/);
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("pins DNS and sends a credential only on the approved TLS request without redirects", async () => {
    const requests: Array<{ url: URL; options: Record<string, unknown> }> = [];
    let nextStatus = 200;
    const transport: ExtensionNetworkTransport = {
      lookup: vi.fn().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]) as never,
      request: ((
        url: URL,
        options: Record<string, unknown>,
        callback: (response: never) => void,
      ) => {
        requests.push({ url, options });
        const request = new EventEmitter() as EventEmitter & { end: () => void };
        request.end = () =>
          queueMicrotask(() => {
            const response = new EventEmitter() as EventEmitter & {
              statusCode: number;
              destroy: () => void;
            };
            response.statusCode = nextStatus;
            response.destroy = vi.fn();
            callback(response as never);
            if (nextStatus === 200) {
              response.emit("data", Buffer.from("hello"));
              response.emit("end");
            }
          });
        return request as never;
      }) as never,
    };
    await expect(
      extensionNetworkGetText(
        "https://api.example.com/data",
        ["api.example.com"],
        "work-token",
        transport,
      ),
    ).resolves.toBe("hello");
    expect(requests[0]?.options.headers).toEqual({
      Accept: "text/plain, application/json",
      "User-Agent": "Tabs-Extension/1",
      Authorization: "Bearer work-token",
    });
    expect(requests[0]?.options.family).toBe(4);
    const pinnedLookup = requests[0]?.options.lookup as (
      host: string,
      options: { all: false },
      callback: (error: null, address: string, family: number) => void,
    ) => void;
    const address = vi.fn();
    pinnedLookup("api.example.com", { all: false }, address);
    expect(address).toHaveBeenCalledWith(null, "8.8.8.8", 4);
    nextStatus = 302;
    await expect(
      extensionNetworkGetText(
        "https://api.example.com/data",
        ["api.example.com"],
        "work-token",
        transport,
      ),
    ).rejects.toThrow(/redirect/);
    expect(requests).toHaveLength(2);
  });

  it("never opens a TLS connection if permission is revoked during DNS", async () => {
    let resolveLookup: (value: { address: string; family: 4 }[]) => void = () => {};
    const pendingLookup = new Promise<{ address: string; family: 4 }[]>((resolve) => {
      resolveLookup = resolve;
    });
    const request = vi.fn();
    const transport: ExtensionNetworkTransport = {
      lookup: vi.fn(() => pendingLookup) as never,
      request: request as never,
    };
    const controller = new AbortController();
    const pending = extensionNetworkGetText(
      "https://api.example.com/me",
      ["api.example.com"],
      "secret",
      transport,
      controller.signal,
    );
    controller.abort();
    resolveLookup([{ address: "8.8.8.8", family: 4 }]);
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(request).not.toHaveBeenCalled();
  });

  it("enforces an overall request deadline even when the socket never responds", async () => {
    vi.useFakeTimers();
    try {
      const destroy = vi.fn();
      const transport: ExtensionNetworkTransport = {
        lookup: vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 4_000));
          return [{ address: "8.8.8.8", family: 4 }];
        }) as never,
        request: (() => {
          const request = new EventEmitter() as EventEmitter & {
            destroy: typeof destroy;
            end: () => void;
          };
          request.destroy = destroy;
          request.end = vi.fn();
          return request as never;
        }) as never,
      };
      const pending = extensionNetworkGetText(
        "https://api.example.com/data",
        ["api.example.com"],
        undefined,
        transport,
      );
      const assertion = expect(pending).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
      expect(destroy).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
