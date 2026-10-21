import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

/** Wait locally so Chromium never probes an unopened backend HTTP port. */
export async function waitForBackendListener(
  port: number,
  signal = AbortSignal.timeout(15_000),
): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("The local backend port is unavailable.");
  }
  for (;;) {
    signal.throwIfAborted();
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection({ host: "127.0.0.1", port, signal });
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("error", (error) => {
          socket.destroy();
          reject(error);
        });
      });
      return;
    } catch (error) {
      signal.throwIfAborted();
      if ((error as NodeJS.ErrnoException).code !== "ECONNREFUSED") throw error;
    }
    await delay(25, undefined, { signal });
  }
}
