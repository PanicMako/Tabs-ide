import { EventEmitter } from "node:events";
import type * as Http from "node:http";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { SignedMetadataEvents } from "./signedMetadataEvents.ts";

describe("signed metadata event broadcaster", () => {
  it("fans out committed PostgreSQL notifications as untrusted hints", async () => {
    const writes: string[] = [];
    const response = Object.assign(new EventEmitter(), {
      writeHead: vi.fn(),
      write: (value: string) => {
        writes.push(value);
        return true;
      },
      end: vi.fn(),
    }) as unknown as Http.ServerResponse;
    const client = Object.assign(new EventEmitter(), {
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    });
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
    const events = new SignedMetadataEvents();
    expect(events.subscribe(response)).toBe(true);
    events.start(pool);
    events.start(pool);
    await vi.waitFor(() =>
      expect(client.query).toHaveBeenCalledWith("LISTEN exchange_signed_metadata"),
    );
    await vi.waitFor(() => expect(client.listenerCount("notification")).toBe(1));
    client.emit("notification", { channel: "other_channel" });
    expect(writes).not.toContain("event: signed-metadata\ndata: refresh\n\n");
    client.emit("notification", { channel: "exchange_signed_metadata" });
    expect(writes).toContain("event: signed-metadata\ndata: refresh\n\n");
    events.stop();
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledWith(true);
    expect(client.listenerCount("notification")).toBe(0);
    expect(client.listenerCount("error")).toBe(0);
    expect(client.listenerCount("end")).toBe(0);
    expect(events.subscribe(response)).toBe(false);
    expect(response.end).toHaveBeenCalledTimes(1);
  });

  it("discards a connection if shutdown happens during LISTEN", async () => {
    let finishListen!: () => void;
    const waiting = new Promise<void>((resolve) => {
      finishListen = resolve;
    });
    const client = Object.assign(new EventEmitter(), {
      query: vi.fn(async () => {
        await waiting;
      }),
      release: vi.fn(),
    });
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
    const events = new SignedMetadataEvents();
    events.start(pool);
    await vi.waitFor(() => expect(client.query).toHaveBeenCalledTimes(1));
    events.stop();
    finishListen();
    await vi.waitFor(() => expect(client.release).toHaveBeenCalledWith(true));
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.listenerCount("notification")).toBe(0);
  });
});
