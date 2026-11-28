import { afterEach, describe, expect, it, vi } from "vitest";

import { readDeviceMjpeg } from "./deviceMjpeg";

const url = "https://example.test/stream.mjpeg";
const contentType = "multipart/x-mixed-replace; boundary=frame";
const encode = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));
const firstJpeg = "\xff\xd8\r\n--frame\r\n\x00\xff\xd9";
const secondJpeg = "\xff\xd8\x01\xff\xd9";

function partHeader(jpeg: string, boundary = "frame") {
  return `--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${encode(jpeg).length}\r\n\r\n`;
}

function part(jpeg: string, boundary = "frame") {
  return `${partHeader(jpeg, boundary)}${jpeg}\r\n`;
}

function mockResponse(
  chunks: Uint8Array[],
  { open = false, status = 200, type = contentType } = {},
) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const pull = vi.fn();
  const body = new ReadableStream<Uint8Array>(
    {
      start(stream) {
        controller = stream;
        for (const chunk of chunks) stream.enqueue(chunk);
        if (!open) stream.close();
      },
      pull,
      cancel,
    },
    { highWaterMark: 0 },
  );
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(body, { status, headers: { "Content-Type": type } }));
  vi.stubGlobal("fetch", fetch);
  return { body, cancel, controller, fetch, pull };
}

function readFrames(signal = new AbortController().signal) {
  return readDeviceMjpeg(url, { credentials: "include", signal });
}

async function collect() {
  const frames: Blob[] = [];
  for await (const frame of readFrames()) frames.push(frame);
  return frames;
}

async function expectJpeg(frame: Blob | undefined, jpeg: string) {
  expect(frame?.type).toBe("image/jpeg");
  expect(new Uint8Array(await frame!.arrayBuffer())).toEqual(encode(jpeg));
}

afterEach(() => vi.unstubAllGlobals());

describe("readDeviceMjpeg", () => {
  it.each([
    { type: contentType, boundary: "frame", bytewise: true },
    {
      type: 'Multipart/X-Mixed-Replace; note="x; boundary=wrong"; BOUNDARY = "camera feed:1"',
      boundary: "camera feed:1",
      bytewise: false,
    },
  ])(
    "reads multiple length-delimited frames with bytewise splits set to $bytewise",
    async ({ type, boundary, bytewise }) => {
      const bytes = encode(
        `${part(firstJpeg, boundary)}${part(secondJpeg, boundary)}--${boundary}--\r\n`,
      );
      const chunks = bytewise ? Array.from(bytes, (byte) => Uint8Array.of(byte)) : [bytes];
      const { body, cancel } = mockResponse(chunks, { type });

      const frames = await collect();

      expect(frames).toHaveLength(2);
      await expectJpeg(frames[0], firstJpeg);
      await expectJpeg(frames[1], secondJpeg);
      expect(cancel).not.toHaveBeenCalled();
      expect(body.locked).toBe(false);
    },
  );

  it("yields as soon as the JPEG arrives and cancels when the consumer returns", async () => {
    const { body, cancel, fetch, pull } = mockResponse(
      [encode(`${partHeader(firstJpeg)}${firstJpeg}`)],
      { open: true },
    );
    const signal = new AbortController().signal;
    const frames = readFrames(signal);

    await expectJpeg((await frames.next()).value, firstJpeg);
    expect(fetch).toHaveBeenCalledWith(url, { credentials: "include", signal });
    expect(pull).not.toHaveBeenCalled();

    await frames.return(undefined);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it.each(["--frame\r\nContent-Type: image/", partHeader(secondJpeg) + "\xff", ""])(
    "ends at EOF without yielding an unfinished part",
    async (tail) => {
      const { body } = mockResponse([encode(part(firstJpeg) + tail)]);

      const frames = await collect();

      expect(frames).toHaveLength(1);
      await expectJpeg(frames[0], firstJpeg);
      expect(body.locked).toBe(false);
    },
  );

  it("rejects a malformed separator before reading another frame", async () => {
    const { body, cancel } = mockResponse([encode(part(firstJpeg).slice(0, -1) + "!")], {
      open: true,
    });
    const frames = readFrames();

    await expectJpeg((await frames.next()).value, firstJpeg);
    await expect(frames.next()).rejects.toThrow(/frame separator/i);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it("bounds the total header bytes across multiple lines and chunks", async () => {
    const { body, cancel } = mockResponse(
      [encode(`--frame\r\nX-One: ${"x".repeat(4096)}\r\n`), encode(`X-Two: ${"x".repeat(4096)}`)],
      { open: true },
    );

    await expect(readFrames().next()).rejects.toThrow(/headers exceed/i);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it.each(["", "0", "-1", "1e3", String(16 * 1024 * 1024 + 1)])(
    "rejects an invalid or oversized Content-Length of %j before reading a frame",
    async (length) => {
      const header = `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${length}\r\n\r\n`;
      const { body, cancel, pull } = mockResponse([encode(header)], { open: true });

      await expect(readFrames().next()).rejects.toThrow(/content-length/i);
      expect(pull).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
    },
  );

  it.each([
    { status: 503, type: contentType, error: /HTTP 503/ },
    { type: "image/jpeg", error: /multipart/ },
    { type: "multipart/x-mixed-replace", error: /boundary/ },
    { type: 'multipart/x-mixed-replace; boundary="frame "', error: /boundary/ },
  ])(
    "rejects unreadable responses and cancels their bodies ($type, $status)",
    async ({ status, type, error }) => {
      const { body, cancel } = mockResponse([], { open: true, status, type });

      await expect(readFrames().next()).rejects.toThrow(error);
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
    },
  );

  it("rejects a successful response without a body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { headers: { "Content-Type": contentType } })),
    );

    await expect(readFrames().next()).rejects.toThrow(/response body/i);
  });

  it("releases the reader after a transport error", async () => {
    const { body, controller, pull } = mockResponse([], { open: true });
    const next = readFrames().next();
    const error = new Error("Connection lost");
    const rejected = expect(next).rejects.toBe(error);
    await vi.waitFor(() => expect(pull).toHaveBeenCalled());

    controller.error(error);

    await rejected;
    expect(body.locked).toBe(false);
  });

  it("cancels and releases a pending read on abort", async () => {
    const { body, cancel, pull } = mockResponse([], { open: true });
    const abort = new AbortController();
    const next = readFrames(abort.signal).next();
    const reason = new Error("Stream stopped");
    const rejected = expect(next).rejects.toBe(reason);
    await vi.waitFor(() => expect(pull).toHaveBeenCalled());

    abort.abort(reason);

    await rejected;
    expect(cancel).toHaveBeenCalledExactlyOnceWith(reason);
    expect(body.locked).toBe(false);
  });

  it("releases the reader when aborted between frames", async () => {
    const { body, cancel } = mockResponse([encode(part(firstJpeg))], { open: true });
    const abort = new AbortController();
    const frames = readFrames(abort.signal);
    await frames.next();

    abort.abort();

    expect(cancel).toHaveBeenCalledExactlyOnceWith(abort.signal.reason);
    expect(body.locked).toBe(false);
    await expect(frames.next()).rejects.toBe(abort.signal.reason);
  });
});
