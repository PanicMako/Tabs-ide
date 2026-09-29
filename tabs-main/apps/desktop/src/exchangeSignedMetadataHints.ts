const CONNECT_TIMEOUT_MS = 15_000;
const RETRY_MS = 10_000;
const MAX_RETRY_MS = 5 * 60_000;
const MIN_HINT_INTERVAL_MS = 10_000;
const MAX_EVENT_BYTES = 4 * 1024;

/** An unsigned SSE event can only request a fresh signed TUF verification. */
export class ExchangeSignedMetadataHints {
  private running = false;
  private controller: AbortController | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHintAt = 0;
  private failureCount = 0;

  constructor(
    private readonly origin: string,
    private readonly onHint: () => void,
    private readonly onError: (error: unknown) => void,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.protocol !== "https:") {
      throw new Error("Signed metadata hints require an HTTPS registry origin.");
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    this.controller?.abort();
    this.controller = null;
    void this.reader?.cancel().catch(() => undefined);
    this.reader = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private hint(): void {
    const now = Date.now();
    if (now - this.lastHintAt < MIN_HINT_INTERVAL_MS) return;
    this.lastHintAt = now;
    try {
      this.onHint();
    } catch (error) {
      this.onError(error);
    }
  }

  private async connect(): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    const endpoint = `${this.origin}/v1/tuf/events`;
    const deadline = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    deadline.unref();
    try {
      const response = await this.fetcher(endpoint, {
        redirect: "manual",
        cache: "no-store",
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
      clearTimeout(deadline);
      if (!this.running || controller.signal.aborted) return;
      if (
        response.status !== 200 ||
        response.url !== endpoint ||
        !response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream") ||
        !response.body
      ) {
        throw new Error("Exchange signed-metadata event stream is invalid.");
      }
      this.failureCount = 0;
      // A reconnect may have missed events. Recheck signed metadata once.
      this.hint();
      const reader = response.body.getReader();
      this.reader = reader;
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (this.running && !controller.signal.aborted) {
          const part = await reader.read();
          if (part.done) break;
          buffer += decoder.decode(part.value, { stream: true });
          buffer = buffer.replaceAll("\r\n", "\n");
          let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) !== -1) {
            const event = buffer.slice(0, boundary);
            if (Buffer.byteLength(event) > MAX_EVENT_BYTES) {
              throw new Error("Exchange signed-metadata event is too large.");
            }
            buffer = buffer.slice(boundary + 2);
            if (event.split("\n").some((line) => line === "event: signed-metadata")) {
              this.hint();
            }
          }
          if (Buffer.byteLength(buffer) > MAX_EVENT_BYTES) {
            throw new Error("Exchange signed-metadata event is too large.");
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        if (this.reader === reader) this.reader = null;
      }
    } catch (error) {
      if (this.running && !controller.signal.aborted) {
        this.failureCount++;
        if ((this.failureCount & (this.failureCount - 1)) === 0) this.onError(error);
      }
    } finally {
      clearTimeout(deadline);
      if (this.controller === controller) this.controller = null;
      if (this.running) {
        this.retryTimer = setTimeout(
          () => {
            this.retryTimer = null;
            void this.connect();
          },
          Math.min(MAX_RETRY_MS, RETRY_MS * 2 ** Math.max(0, Math.min(this.failureCount - 1, 5))),
        );
        this.retryTimer.unref();
      }
    }
  }
}
