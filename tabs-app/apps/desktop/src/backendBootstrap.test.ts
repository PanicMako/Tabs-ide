import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { writeBackendBootstrap } from "./backendBootstrap";

describe("writeBackendBootstrap", () => {
  it("waits for the shell, then snapshots and ends the bootstrap pipe", async () => {
    const stream = new PassThrough();
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const chunks: string[] = [];
    stream.on("data", (chunk) => chunks.push(String(chunk)));
    const payload = vi.fn(() => ({ mode: "desktop" as const, port: 4888 }));
    const onError = vi.fn();
    const writing = writeBackendBootstrap(stream, ready, payload, onError);
    expect(chunks).toEqual([]);
    expect(payload).not.toHaveBeenCalled();
    resolveReady();
    await writing;
    expect(JSON.parse(chunks.join(""))).toEqual({ mode: "desktop", port: 4888 });
    expect(stream.writableEnded).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not write after the backend closes its pipe", async () => {
    const stream = new PassThrough();
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const payload = vi.fn();
    const writing = writeBackendBootstrap(stream, ready, payload, vi.fn());
    stream.destroy();
    resolveReady();
    await writing;
    expect(payload).not.toHaveBeenCalled();
  });

  it("contains a pipe error while shell resolution is still pending", async () => {
    const stream = new PassThrough();
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const onError = vi.fn();
    const writing = writeBackendBootstrap(stream, ready, vi.fn(), onError);
    const failure = new Error("pipe closed");
    stream.destroy(failure);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
    resolveReady();
    await writing;
  });
});

describe("backend configuration barrier", () => {
  it.each(["shell", "configuration"] as const)(
    "waits for both prerequisites when %s finishes first",
    async (first) => {
      const stream = new PassThrough();
      let shellReady!: () => void;
      let configurationReady!: () => void;
      const shell = new Promise<void>((resolve) => {
        shellReady = resolve;
      });
      const configuration = new Promise<void>((resolve) => {
        configurationReady = resolve;
      });
      let port = 0;
      const payload = vi.fn(() => ({ mode: "desktop" as const, port }));
      const chunks: string[] = [];
      stream.on("data", (chunk) => chunks.push(String(chunk)));
      const writing = writeBackendBootstrap(
        stream,
        Promise.all([shell, configuration]),
        payload,
        vi.fn(),
      );
      if (first === "shell") shellReady();
      else {
        port = 4888;
        configurationReady();
      }
      await Promise.resolve();
      expect(payload).not.toHaveBeenCalled();
      expect(chunks).toEqual([]);
      port = 4888;
      shellReady();
      configurationReady();
      await writing;
      expect(JSON.parse(chunks.join(""))).toEqual({ mode: "desktop", port: 4888 });
    },
  );
});
