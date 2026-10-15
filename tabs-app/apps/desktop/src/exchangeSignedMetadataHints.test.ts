import { afterEach, describe, expect, it, vi } from "vitest";
import { ExchangeSignedMetadataHints } from "./exchangeSignedMetadataHints";

const origin = "https://exchange.tabs.example";
const endpoint = `${origin}/v1/tuf/events`;

afterEach(() => vi.restoreAllMocks());

describe("Exchange signed-metadata hints", () => {
  it("rejects insecure registry origins", () => {
    expect(
      () =>
        new ExchangeSignedMetadataHints(
          "http://localhost:8787",
          () => {},
          () => {},
        ),
    ).toThrow(/HTTPS/);
  });

  it("wakes signed checks on connection and rate-limited publication hints", async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    const response = new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    });
    Object.defineProperty(response, "url", { value: endpoint });
    const fetcher = vi.fn(async () => response) as unknown as typeof fetch;
    const onHint = vi.fn();
    const onError = vi.fn();
    let now = 100_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const hints = new ExchangeSignedMetadataHints(origin, onHint, onError, fetcher);
    hints.start();
    await vi.waitFor(() => expect(onHint).toHaveBeenCalledTimes(1));
    expect(fetcher).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({ redirect: "manual", cache: "no-store" }),
    );
    const send = (event: string) => streamController.enqueue(new TextEncoder().encode(event));
    send("event: signed-metadata\ndata: refresh\n\n");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onHint).toHaveBeenCalledTimes(1);
    now += 11_000;
    send(": keepalive\n\nevent: signed-metadata\ndata: refresh\n\n");
    await vi.waitFor(() => expect(onHint).toHaveBeenCalledTimes(2));
    expect(onError).not.toHaveBeenCalled();
    hints.stop();
  });

  it("rejects redirects and never treats their contents as a hint", async () => {
    const response = new Response("redirected", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    Object.defineProperty(response, "url", { value: "https://other.example/v1/tuf/events" });
    const onHint = vi.fn();
    const onError = vi.fn();
    const hints = new ExchangeSignedMetadataHints(
      origin,
      onHint,
      onError,
      vi.fn(async () => response) as unknown as typeof fetch,
    );
    hints.start();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onHint).not.toHaveBeenCalled();
    hints.stop();
  });

  it("accepts a batch of small events larger than one event's byte limit", async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    const response = new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    Object.defineProperty(response, "url", { value: endpoint });
    const onHint = vi.fn();
    const onError = vi.fn();
    let now = 100_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const hints = new ExchangeSignedMetadataHints(
      origin,
      onHint,
      onError,
      vi.fn(async () => response) as unknown as typeof fetch,
    );
    hints.start();
    await vi.waitFor(() => expect(onHint).toHaveBeenCalledTimes(1));
    now += 11_000;
    streamController.enqueue(
      new TextEncoder().encode(
        `${": keepalive\n\n".repeat(600)}event: signed-metadata\ndata: refresh\n\n`,
      ),
    );
    await vi.waitFor(() => expect(onHint).toHaveBeenCalledTimes(2));
    expect(onError).not.toHaveBeenCalled();
    hints.stop();
  });

  it("rejects one oversized unfinished event", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${"x".repeat(4096)}`));
      },
    });
    const response = new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    Object.defineProperty(response, "url", { value: endpoint });
    const onError = vi.fn();
    const hints = new ExchangeSignedMetadataHints(
      origin,
      () => {},
      onError,
      vi.fn(async () => response) as unknown as typeof fetch,
    );
    hints.start();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)));
    expect(String(onError.mock.calls[0]?.[0])).toContain("too large");
    hints.stop();
  });
});
