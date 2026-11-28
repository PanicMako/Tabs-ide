const MAX_HEADER_BYTES = 8 * 1024;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

function readBoundary(contentType: string): string {
  const mediaType = /^multipart\/x-mixed-replace\s*(?=;|$)/i.exec(contentType);
  if (!mediaType) throw new Error("Expected a multipart MJPEG response");

  const parameter =
    /;\s*([\w!#$%&'*+.^`|~-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([\w!#$%&'*+.^`|~-]+))\s*/gy;
  parameter.lastIndex = mediaType[0].length;
  let boundary: string | undefined;
  while (parameter.lastIndex < contentType.length) {
    const match = parameter.exec(contentType);
    if (!match) throw new Error("Invalid MJPEG content type parameter");

    const [, name, quoted, unquoted] = match;
    if (name?.toLowerCase() === "boundary") {
      if (boundary !== undefined) throw new Error("Duplicate MJPEG boundary");
      boundary = quoted?.replace(/\\(.)/g, "$1") ?? unquoted;
    }
  }

  // RFC 2046 limits boundaries to 70 characters and disallows trailing spaces.
  if (!boundary || !/^[\w'()+_,./:=? -]{0,69}[\w'()+_,./:=?-]$/.test(boundary)) {
    throw new Error("Missing or invalid MJPEG boundary");
  }
  return boundary;
}

export async function* readDeviceMjpeg(
  url: string,
  options: { credentials: RequestCredentials; signal: AbortSignal },
): AsyncGenerator<Blob> {
  const { signal } = options;
  signal.throwIfAborted();
  const response = await fetch(url, options);
  const reader = response.body?.getReader();

  let released = false;
  const releaseReader = () => {
    if (!reader || released) return;
    released = true;
    // Fetch may already have errored the stream. Release the lock even if cancellation rejects.
    void reader.cancel(signal.reason).catch(() => {});
    reader.releaseLock();
  };
  signal.addEventListener("abort", releaseReader, { once: true });

  try {
    signal.throwIfAborted();
    if (!response.ok) throw new Error(`MJPEG request failed (HTTP ${response.status})`);
    if (!reader) throw new Error("Missing MJPEG response body");

    const boundaryLine = `--${readBoundary(response.headers.get("content-type") ?? "")}`;
    const closingBoundary = `${boundaryLine}--`;
    const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    const header = new Uint8Array(MAX_HEADER_BYTES);
    let chunk: Uint8Array = new Uint8Array(0);
    let offset = 0;
    let headerBytesLeft = MAX_HEADER_BYTES;

    const refill = async () => {
      signal.throwIfAborted();
      for (;;) {
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) return false;
        if (value.length > 0) {
          chunk = value;
          offset = 0;
          return true;
        }
      }
    };

    const readLine = async () => {
      signal.throwIfAborted();
      let length = 0;
      while (headerBytesLeft > 0) {
        if (offset === chunk.length && !(await refill())) return null;

        const available = chunk.subarray(offset, offset + headerBytesLeft);
        const newline = available.indexOf(10);
        const count = newline === -1 ? available.length : newline + 1;
        header.set(available.subarray(0, count), length);
        length += count;
        offset += count;
        headerBytesLeft -= count;

        if (newline !== -1) {
          if (length < 2 || header[length - 2] !== 13) {
            throw new Error("Invalid MJPEG header line ending");
          }
          return decoder.decode(header.subarray(0, length - 2));
        }
      }
      throw new Error("MJPEG headers exceed the byte limit");
    };

    for (;;) {
      headerBytesLeft = MAX_HEADER_BYTES;
      const delimiter = await readLine();
      if (delimiter === null || delimiter === closingBoundary) return;
      if (delimiter !== boundaryLine) throw new Error("Unexpected MJPEG boundary");

      const headers = new Map<string, string>();
      for (;;) {
        const line = await readLine();
        if (line === null) return;
        if (line === "") break;
        const separator = line.indexOf(":");
        const name = line.slice(0, separator).toLowerCase();
        if (separator <= 0 || headers.has(name)) throw new Error("Invalid MJPEG part headers");
        headers.set(name, line.slice(separator + 1).trim());
      }

      if (headers.get("content-type")?.toLowerCase() !== "image/jpeg") {
        throw new Error("Expected an image/jpeg MJPEG part");
      }
      const contentLength = headers.get("content-length");
      const length = Number(contentLength);
      if (
        !contentLength ||
        !/^\d+$/.test(contentLength) ||
        length <= 0 ||
        length > MAX_FRAME_BYTES
      ) {
        throw new Error("Invalid or oversized MJPEG Content-Length");
      }

      const frame = new Uint8Array(length);
      let written = 0;
      while (written < frame.length) {
        if (offset === chunk.length && !(await refill())) return;
        const count = Math.min(frame.length - written, chunk.length - offset);
        frame.set(chunk.subarray(offset, offset + count), written);
        written += count;
        offset += count;
      }

      signal.throwIfAborted();
      yield new Blob([frame], { type: "image/jpeg" });
      signal.throwIfAborted();

      for (const byte of [13, 10]) {
        if (offset === chunk.length && !(await refill())) return;
        if (chunk[offset++] !== byte) throw new Error("Invalid MJPEG frame separator");
      }
    }
  } finally {
    signal.removeEventListener("abort", releaseReader);
    releaseReader();
  }
}
