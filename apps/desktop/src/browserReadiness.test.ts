import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { probeBrowserReadiness } from "./browserReadiness";

describe("desktop readiness probe", () => {
  it("reads real loopback HTTP status and does not follow redirects outside loopback", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/broken") {
        response.writeHead(500);
        response.end();
      } else if (request.url === "/redirect") {
        response.writeHead(302, { location: "https://example.com/" });
        response.end();
      } else {
        response.writeHead(200);
        response.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    try {
      const origin = `http://127.0.0.1:${address.port}`;
      expect(await probeBrowserReadiness(`${origin}/broken`)).toMatchObject({
        state: "unhealthy",
        httpStatus: 500,
      });
      expect(await probeBrowserReadiness(`${origin}/redirect`)).toMatchObject({
        state: "reachable",
        httpStatus: 302,
      });
      expect(await probeBrowserReadiness(origin)).toMatchObject({
        state: "ready",
        httpStatus: 200,
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("never invents HTTP 200 for an opaque result", async () => {
    const result = await probeBrowserReadiness(
      "http://localhost/",
      100,
      vi.fn().mockResolvedValue({ status: 0 }),
    );
    expect(result).toMatchObject({ state: "unknown" });
    expect(result.httpStatus).toBeUndefined();
  });
  it("distinguishes refused connections from unknown network errors", async () => {
    expect(
      await probeBrowserReadiness(
        "http://localhost/",
        100,
        vi.fn().mockRejectedValue({ cause: { code: "ECONNREFUSED" } }),
      ),
    ).toMatchObject({ state: "offline" });
    expect(
      await probeBrowserReadiness(
        "http://localhost/",
        100,
        vi.fn().mockRejectedValue(new TypeError("failed")),
      ),
    ).toMatchObject({ state: "unknown" });
  });
  it.each([
    "https://example.com/",
    "file:///tmp/page",
    "http://user:password@localhost/",
    "http://localhost.example.com/",
  ])("rejects non-loopback or credential-bearing target %s before fetching", async (url) => {
    const fetcher = vi.fn();
    expect((await probeBrowserReadiness(url, 100, fetcher)).state).toBe("not_local");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("accepts IPv6 loopback and aborts a stalled request", async () => {
    const fetcher = vi.fn(
      (_url, options) =>
        new Promise<Response>((_resolve, reject) =>
          options.signal.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
    expect(await probeBrowserReadiness("http://[::1]:3000/", 100, fetcher)).toMatchObject({
      state: "offline",
      error: "Probe timed out.",
    });
  });
});
