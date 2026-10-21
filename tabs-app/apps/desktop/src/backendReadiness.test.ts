import { createServer, type Server } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, it } from "vitest";
import { waitForBackendListener } from "./backendReadiness";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  servers.length = 0;
});
async function listen(server: Server, port = 0): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return (server.address() as { port: number }).port;
}
it("connects to a listening loopback server and closes its probe socket", async () => {
  const server = createServer((socket) => socket.end());
  servers.push(server);
  await waitForBackendListener(await listen(server));
});
it("waits for a late backend listener without failing the renderer request", async () => {
  const reservation = createServer();
  const port = await listen(reservation);
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const controller = new AbortController();
  let connected = false;
  const waiting = waitForBackendListener(port, controller.signal).then(() => {
    connected = true;
  });
  await delay(35);
  expect(connected).toBe(false);
  const server = createServer((socket) => socket.end());
  servers.push(server);
  await listen(server, port);
  await waiting;
});
it("bounds the wait when the backend never starts", async () => {
  const reservation = createServer();
  const port = await listen(reservation);
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  await expect(waitForBackendListener(port, AbortSignal.timeout(40))).rejects.toThrow();
});
it("rejects an unconfigured backend port without opening a connection", async () => {
  await expect(waitForBackendListener(0)).rejects.toThrow("port is unavailable");
});
