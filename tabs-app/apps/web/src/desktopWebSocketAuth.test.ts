import { afterEach, expect, it, vi } from "vitest";
import { authorizeDesktopWebSocket } from "./desktopWebSocketAuth";

afterEach(() => vi.unstubAllGlobals());

it("exchanges the bootstrap credential once and obtains a fresh ticket on reconnect", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access_token: "session" }))
    .mockResolvedValueOnce(Response.json({ ticket: "first" }))
    .mockResolvedValueOnce(Response.json({ ticket: "second" }));
  vi.stubGlobal("fetch", fetchMock);
  const raw = "ws://localhost:4050/ws?orchestrationProtocol=2&token=bootstrap";
  const first = new URL(await authorizeDesktopWebSocket(raw));
  const second = new URL(await authorizeDesktopWebSocket(raw));
  expect(first.searchParams.has("token")).toBe(false);
  expect(first.searchParams.get("wsTicket")).toBe("first");
  expect(second.searchParams.get("wsTicket")).toBe("second");
  expect(second.searchParams.get("orchestrationProtocol")).toBe("2");
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(fetchMock.mock.calls[1]?.[1].headers.Authorization).toBe("Bearer session");
});

it("rejects failed authentication and retries the exchange without leaking credentials", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response("", { status: 401 }))
    .mockResolvedValueOnce(Response.json({ access_token: "session" }))
    .mockResolvedValueOnce(Response.json({ ticket: "ticket" }));
  vi.stubGlobal("fetch", fetchMock);
  const raw = "ws://localhost:4051/ws?token=private-bootstrap";
  await expect(authorizeDesktopWebSocket(raw)).rejects.toThrow("HTTP 401");
  expect(await authorizeDesktopWebSocket(raw)).not.toContain("private-bootstrap");
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
