import { describe, it, expect } from "vite-plus/test";
import * as Net from "node:net";
import { receiveCodexAuthCallback } from "./codexAuthCallback.ts";
async function request() {
  const server = Net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as Net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const redirect = `http://127.0.0.1:${port}/auth/callback`;
  const state = "audit-state-123456789";
  const url = new URL("https://auth.openai.com/api/accounts/authorize");
  url.search = new URLSearchParams({
    redirect_uri: redirect,
    state,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: "b".repeat(43),
    client_id: "dynamic_agent_client",
  }).toString();
  return { url: url.toString(), redirect, state };
}
describe("actual loopback callback audit", () => {
  it("rejects foreign state, accepts matching callback, closes listener", async () => {
    const r = await request();
    const callback = `${r.redirect}?state=${r.state}&code=fake-audit-code`;
    const received = await receiveCodexAuthCallback(r.url, async () => {
      expect((await fetch(`${r.redirect}?state=wrong&code=fake`)).status).toBe(400);
      const response = await fetch(callback);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      return true;
    });
    expect(received).toBe(callback);
    await expect(fetch(callback)).rejects.toThrow();
  });
  it("cleans cancellation and permits reuse of the same state", async () => {
    const r = await request();
    const controller = new AbortController();
    await expect(
      receiveCodexAuthCallback(
        r.url,
        async () => {
          controller.abort();
          return true;
        },
        undefined,
        controller.signal,
      ),
    ).rejects.toThrow("cancelled");
    const callback = `${r.redirect}?state=${r.state}&code=fake-audit-code`;
    expect(
      await receiveCodexAuthCallback(r.url, async () => {
        await fetch(callback);
        return true;
      }),
    ).toBe(callback);
  });
});
