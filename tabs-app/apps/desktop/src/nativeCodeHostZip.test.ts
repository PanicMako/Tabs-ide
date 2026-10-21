import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createNativeCodeZip,
  NativeCodeZipOperations,
  type NativeZipWriter,
} from "./nativeCodeHostZip";

describe("createNativeCodeZip", () => {
  it("prepares bounded inline and local-file entries", async () => {
    const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-native-zip-"));
    const source = Path.join(root, "source.bin");
    FS.writeFileSync(source, Buffer.from([1, 2, 3, 4]));
    const zip = vi.fn(async (destination: string) => FS.writeFileSync(destination, "zip"));

    await createNativeCodeZip(
      zip,
      { fsPath: Path.join(root, "out", "report.zip") },
      [
        { path: "summary.txt", contents: "ok" },
        { path: "data/source.bin", source: { fsPath: source }, size: 3 },
      ],
      { maxEntries: 2, maxSize: 10 },
    );

    expect(zip).toHaveBeenCalledWith(Path.join(root, "out", "report.zip"), [
      { path: "summary.txt", contents: "ok" },
      {
        path: "data/source.bin",
        localPath: source,
        localPathSize: 3,
      },
    ]);
  });

  it("rejects duplicate and escaping entry paths", async () => {
    const zip = vi.fn();
    await expect(
      createNativeCodeZip(zip, { fsPath: "/tmp/out.zip" }, [
        { path: "same", contents: "1" },
        { path: "same", contents: "2" },
      ]),
    ).rejects.toThrow("Duplicate ZIP entry");
    await expect(
      createNativeCodeZip(zip, { fsPath: "/tmp/out.zip" }, [{ path: "../outside", contents: "x" }]),
    ).rejects.toThrow("Invalid ZIP entry path");
    expect(zip).not.toHaveBeenCalled();
  });
});

function cancellation() {
  let cancelled = false;
  const listeners = new Set<() => void>();
  return {
    token: {
      get isCancellationRequested() {
        return cancelled;
      },
      onCancellationRequested(listener: () => void) {
        listeners.add(listener);
        return {
          dispose: () => {
            listeners.delete(listener);
          },
        };
      },
    },
    cancel() {
      cancelled = true;
      for (const listener of listeners) listener();
    },
    dispose: vi.fn(() => listeners.clear()),
  };
}

it("stops cancelled ZIP writes, reports bounded byte totals and scopes operation IDs to a renderer", async () => {
  const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-cancel-zip-"));
  const sources: ReturnType<typeof cancellation>[] = [];
  const progress = vi.fn();
  const writers = new Map<string, () => void>();
  const zip: NativeZipWriter = async (destination, _files, options) => {
    FS.writeFileSync(destination, "partial");
    options?.onProgress?.(2, "summary.txt");
    await new Promise<void>((resolve, reject) => {
      writers.set(destination, resolve);
      options?.token?.onCancellationRequested(() => reject(new Error("Canceled")));
    });
  };
  const operations = new NativeCodeZipOperations(
    zip,
    () => {
      const source = cancellation();
      sources.push(source);
      return source;
    },
    progress,
  );
  const firstPath = Path.join(root, "first.zip");
  const secondPath = Path.join(root, "second.zip");
  const first = operations.create(
    1,
    { fsPath: firstPath },
    [{ path: "summary.txt", contents: "four" }],
    { operationId: "same" },
  );
  const second = operations.create(
    2,
    { fsPath: secondPath },
    [{ path: "summary.txt", contents: "four" }],
    { operationId: "same" },
  );
  try {
    await vi.waitFor(() => expect(writers.size).toBe(2));
    expect(progress).toHaveBeenCalledWith({
      operationId: "same",
      bytes: 2,
      total: 4,
      path: "summary.txt",
    });
    const cancelled = expect(first).rejects.toThrow("Canceled");
    operations.cancel(1, "same");
    await cancelled;
    expect(FS.existsSync(firstPath)).toBe(false);
    expect(sources[1]!.token.isCancellationRequested).toBe(false);
    writers.get(secondPath)!();
    await second;
    expect(FS.existsSync(secondPath)).toBe(true);
    expect(sources.every((source) => source.dispose.mock.calls.length === 1)).toBe(true);
    operations.cancel(1, "same");
  } finally {
    operations.dispose();
    await Promise.allSettled([first, second]);
    FS.rmSync(root, { recursive: true, force: true });
  }
});

it("rejects duplicate operation IDs and cancels outstanding work on window disposal", async () => {
  const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-dispose-zip-"));
  let started = false;
  const source = cancellation();
  const zip: NativeZipWriter = async (destination, _files, options) => {
    FS.writeFileSync(destination, "partial");
    started = true;
    await new Promise<void>((_resolve, reject) => {
      options!.token!.onCancellationRequested(() => reject(new Error("Canceled")));
    });
  };
  const operations = new NativeCodeZipOperations(zip, () => source, vi.fn());
  const args = [{ fsPath: Path.join(root, "out.zip") }, [], { operationId: "id" }] as const;
  const pending = operations.create(1, ...args);
  try {
    await vi.waitFor(() => expect(started).toBe(true));
    await expect(operations.create(1, ...args)).rejects.toThrow("already in use");
    const cancelled = expect(pending).rejects.toThrow("Canceled");
    await operations.shutdown();
    await cancelled;
    await expect(operations.create(1, ...args)).rejects.toThrow("shutting down");
    expect(source.dispose).toHaveBeenCalledOnce();
    expect(FS.existsSync(Path.join(root, "out.zip"))).toBe(false);
  } finally {
    operations.dispose();
    await Promise.allSettled([pending]);
    FS.rmSync(root, { recursive: true, force: true });
  }
});

it("rejects cancellation before preparation without calling the writer", async () => {
  const source = cancellation();
  source.cancel();
  const writer = vi.fn();
  await expect(
    createNativeCodeZip(writer, { fsPath: "/tmp/not-created.zip" }, [], undefined, {
      token: source.token,
      progress: vi.fn(),
    }),
  ).rejects.toMatchObject({ name: "Canceled" });
  expect(writer).not.toHaveBeenCalled();
});
