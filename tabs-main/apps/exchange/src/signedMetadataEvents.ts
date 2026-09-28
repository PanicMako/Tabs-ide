import type * as Http from "node:http";
import type { Pool, PoolClient } from "pg";

const CHANNEL = "exchange_signed_metadata";
const MAX_SUBSCRIBERS = 1_000;
const HEARTBEAT_MS = 25_000;
const RECONNECT_MS = 10_000;

/** These unauthenticated events are hints only; clients must verify signed TUF metadata. */
export class SignedMetadataEvents {
  private readonly subscribers = new Set<Http.ServerResponse>();
  private readonly heartbeats = new Map<Http.ServerResponse, ReturnType<typeof setInterval>>();
  private listener: PoolClient | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  subscribe(response: Http.ServerResponse): boolean {
    if (this.subscribers.size >= MAX_SUBSCRIBERS) return false;
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    });
    response.write("retry: 10000\n\n");
    this.subscribers.add(response);
    const heartbeat = setInterval(() => {
      if (!response.write(": keepalive\n\n")) response.end();
    }, HEARTBEAT_MS);
    heartbeat.unref();
    this.heartbeats.set(response, heartbeat);
    response.on("close", () => this.unsubscribe(response));
    return true;
  }

  publishHint(): void {
    for (const response of this.subscribers) {
      if (!response.write("event: signed-metadata\ndata: refresh\n\n")) response.end();
    }
  }

  start(pool: Pool): void {
    if (this.stopped || this.listener || this.reconnectTimer) return;
    this.pool = pool;
    void this.connect(pool);
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const listener = this.listener;
    this.listener = null;
    listener?.release();
    for (const response of this.subscribers) response.end();
    for (const heartbeat of this.heartbeats.values()) clearInterval(heartbeat);
    this.heartbeats.clear();
    this.subscribers.clear();
  }

  private unsubscribe(response: Http.ServerResponse): void {
    this.subscribers.delete(response);
    const heartbeat = this.heartbeats.get(response);
    if (heartbeat) clearInterval(heartbeat);
    this.heartbeats.delete(response);
  }

  private async connect(pool: Pool): Promise<void> {
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      if (this.stopped) {
        client.release();
        return;
      }
      await client.query(`LISTEN ${CHANNEL}`);
      if (this.stopped) {
        client.release();
        return;
      }
      this.listener = client;
      client.on("notification", this.onNotification);
      client.on("error", this.onListenerError);
      client.on("end", this.onListenerError);
    } catch (error) {
      client?.release(true);
      process.stderr.write(`Exchange signed-metadata listener failed: ${String(error)}\n`);
      this.scheduleReconnect(pool);
    }
  }

  private readonly onNotification = (message: { channel: string }): void => {
    if (message.channel === CHANNEL) this.publishHint();
  };

  private readonly onListenerError = (): void => {
    const client = this.listener;
    if (!client) return;
    this.listener = null;
    client.removeListener("notification", this.onNotification);
    client.removeListener("error", this.onListenerError);
    client.removeListener("end", this.onListenerError);
    client.release(true);
    // The caller keeps minute polling; this reconnection only improves latency.
    if (this.pool) this.scheduleReconnect(this.pool);
  };

  private pool: Pool | null = null;

  private scheduleReconnect(pool: Pool): void {
    this.pool = pool;
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(pool);
    }, RECONNECT_MS);
    this.reconnectTimer.unref();
  }
}
