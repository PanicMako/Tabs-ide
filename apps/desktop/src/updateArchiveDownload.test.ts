import { createHash } from "node:crypto";
import { createServer, type ServerResponse, type IncomingMessage } from "node:http";
import * as FS from "node:fs/promises";
import * as OS from "node:os";
import * as Path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { downloadUpdateArchive } from "./updateArchiveDownload";

const archive = Buffer.from("verified-update-archive");
const checksum = createHash("sha512").update(archive).digest("base64");
async function fixture(
  run: (url: string, path: string) => Promise<void>,
  handler: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const directory = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-update-test-"));
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  try {
    await run(
      `http://127.0.0.1:${address.port}/update.zip`,
      Path.join(directory, "update.download"),
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await FS.rm(directory, { recursive: true, force: true });
  }
}
function options(url: string, partialPath: string) {
  return {
    url,
    partialPath,
    size: archive.length,
    sha512: checksum,
    headers: {},
    onProgress: () => {},
    idleTimeoutMs: 1500,
  };
}

describe("update archive download", () => {
  it("allows an active transfer to exceed the idle timeout in total", async () => {
    const directory = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-update-clock-"));
    vi.useFakeTimers();
    let firstChunk: () => void = () => {};
    let secondChunk: () => void = () => {};
    const firstWritten = new Promise<void>((resolve) => {
      firstChunk = resolve;
    });
    const secondWritten = new Promise<void>((resolve) => {
      secondChunk = resolve;
    });
    vi.stubGlobal(
      "fetch",
      async (_url: string, init: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), {
                once: true,
              });
              controller.enqueue(archive.subarray(0, 5));
              setTimeout(() => controller.enqueue(archive.subarray(5, 10)), 60_000);
              setTimeout(() => {
                controller.enqueue(archive.subarray(10));
                controller.close();
              }, 120_000);
            },
          }),
        ),
    );
    try {
      const path = Path.join(directory, "update.download");
      const download = downloadUpdateArchive({
        ...options("https://example.test/update", path),
        idleTimeoutMs: 90_000,
        onProgress: (percent) => {
          if (percent >= (5 / archive.length) * 100) firstChunk();
          if (percent >= (10 / archive.length) * 100) secondChunk();
        },
      });
      await firstWritten;
      await vi.advanceTimersByTimeAsync(60_000);
      await secondWritten;
      await vi.advanceTimersByTimeAsync(60_000);
      await download;
      expect(await FS.readFile(path)).toEqual(archive);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      await FS.rm(directory, { recursive: true, force: true });
    }
  });
  it("keeps a stalled partial download and resumes using a validated Range", async () => {
    let request = 0;
    await fixture(
      async (url, path) => {
        await expect(downloadUpdateArchive(options(url, path))).rejects.toThrow("stalled");
        expect(await FS.readFile(path)).toEqual(archive.subarray(0, 5));
        await downloadUpdateArchive(options(url, path));
        expect(await FS.readFile(path)).toEqual(archive);
      },
      (req, res) => {
        if (request++ === 0) {
          res.write(archive.subarray(0, 5));
          return;
        }
        expect(req.headers.range).toBe("bytes=5-");
        res.writeHead(206, { "Content-Range": `bytes 5-${archive.length - 1}/${archive.length}` });
        res.end(archive.subarray(5));
      },
    );
  });
  it("restarts safely when a server ignores the resume range", async () => {
    await fixture(
      async (url, path) => {
        await FS.writeFile(path, archive.subarray(0, 5));
        await downloadUpdateArchive(options(url, path));
        expect(await FS.readFile(path)).toEqual(archive);
      },
      (_req, res) => res.end(archive),
    );
  });
  it("rejects and removes an archive with an invalid checksum", async () => {
    await fixture(
      async (url, path) => {
        await expect(
          downloadUpdateArchive({ ...options(url, path), sha512: "invalid" }),
        ).rejects.toThrow("checksum");
        await expect(FS.stat(path)).rejects.toMatchObject({ code: "ENOENT" });
      },
      (_req, res) => res.end(archive),
    );
  });
  it("rejects a mismatched range without appending untrusted bytes", async () => {
    await fixture(
      async (url, path) => {
        await FS.writeFile(path, archive.subarray(0, 5));
        await expect(downloadUpdateArchive(options(url, path))).rejects.toThrow(
          "unexpected download range",
        );
        expect(await FS.readFile(path)).toEqual(archive.subarray(0, 5));
      },
      (_req, res) => {
        res.writeHead(206, { "Content-Range": "bytes 0-4/5" });
        res.end("wrong");
      },
    );
  });
  it("rejects an archive that exceeds the signed size", async () => {
    await fixture(
      async (url, path) => {
        await expect(downloadUpdateArchive(options(url, path))).rejects.toThrow("signed size");
        await expect(FS.stat(path)).rejects.toMatchObject({ code: "ENOENT" });
      },
      (_req, res) => res.end(Buffer.concat([archive, Buffer.from("extra")])),
    );
  });
});
