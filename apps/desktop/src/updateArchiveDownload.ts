import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import * as FS from "node:fs/promises";

export interface UpdateArchiveDownloadOptions {
  url: string;
  partialPath: string;
  size: number;
  sha512: string;
  headers: Readonly<Record<string, string>>;
  onProgress: (percent: number) => void;
  idleTimeoutMs?: number;
}

/** Resume only bytes belonging to a verified manifest, then verify the entire archive. */
export async function downloadUpdateArchive(options: UpdateArchiveDownloadOptions): Promise<void> {
  const { partialPath, size, sha512, onProgress } = options;
  let received = 0;
  try {
    const stat = await FS.lstat(partialPath);
    if (!stat.isFile()) throw new Error("The update cache is not a regular file.");
    received = stat.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (received > size) {
    await FS.rm(partialPath);
    received = 0;
  }
  let hash = createHash("sha512");
  if (received > 0) {
    for await (const chunk of createReadStream(partialPath)) hash.update(chunk);
  }
  onProgress(Math.min(99, (received / size) * 100));
  const controller = new AbortController();
  const idleTimeoutMs = options.idleTimeoutMs ?? 120_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const armTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        controller.abort(new Error("The update connection stalled. Retry to resume the download.")),
      idleTimeoutMs,
    );
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (received < size) {
      armTimeout();
      const response = await fetch(options.url, {
        headers: {
          ...options.headers,
          "Accept-Encoding": "identity",
          ...(received > 0 ? { Range: `bytes=${received}-` } : {}),
        },
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`Update server returned HTTP ${response.status}.`);
      if (!response.body) throw new Error("The update server returned an empty download.");
      reader = response.body.getReader();
      if (response.status === 206) {
        const range = response.headers.get("content-range");
        if (range !== `bytes ${received}-${size - 1}/${size}`)
          throw new Error("The update server returned an unexpected download range.");
      } else if (response.status === 200) {
        // Some servers ignore Range. Restart instead of appending duplicate bytes.
        received = 0;
        hash = createHash("sha512");
      } else {
        throw new Error(`Unexpected update response HTTP ${response.status}.`);
      }
      const handle = await FS.open(partialPath, received > 0 ? "a" : "w", 0o600);
      let oversized = false;
      try {
        while (true) {
          armTimeout();
          const { done, value } = await reader.read();
          clearTimeout(timer);
          if (done) break;
          if (received + value.byteLength > size) {
            oversized = true;
            throw new Error("The update download exceeded its signed size.");
          }
          await handle.writeFile(value);
          hash.update(value);
          received += value.byteLength;
          onProgress(Math.min(99, (received / size) * 100));
        }
      } finally {
        await handle.close();
        if (oversized) await FS.rm(partialPath, { force: true });
      }
    }
    if (received < size)
      throw new Error("The update download ended early. Retry to resume the download.");
    if (hash.digest("base64") !== sha512) {
      await FS.rm(partialPath, { force: true });
      throw new Error("The downloaded update did not match its signed checksum.");
    }
  } finally {
    clearTimeout(timer);
    await reader?.cancel().catch(() => undefined);
    controller.abort();
  }
}
