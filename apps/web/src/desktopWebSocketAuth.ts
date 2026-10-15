// Bootstrap credentials are exchanged over HTTP; only single-use tickets go on the socket URL.
const sessions = new Map<string, Promise<string>>();

async function requireJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`Desktop authentication failed (HTTP ${response.status}).`);
  return response.json();
}

export async function authorizeDesktopWebSocket(rawUrl: string): Promise<string> {
  const url = new URL(rawUrl);
  const bootstrapToken = url.searchParams.get("token");
  if (!bootstrapToken) return rawUrl;
  const protocol = url.protocol === "wss:" ? "https:" : "http:";
  const origin = `${protocol}//${url.host}`;
  let session = sessions.get(rawUrl);
  if (!session) {
    session = fetch(new URL("/oauth/token", origin), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: bootstrapToken,
        subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      }),
    })
      .then(requireJson)
      .then((body) => {
        if (typeof body.access_token !== "string" || !body.access_token) {
          throw new Error("Desktop authentication returned no session credential.");
        }
        return body.access_token;
      });
    sessions.set(rawUrl, session);
  }
  try {
    const accessToken = await session;
    const response = await fetch(new URL("/api/auth/websocket-ticket", origin), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(10_000),
    });
    const body = await requireJson(response);
    if (typeof body.ticket !== "string" || !body.ticket) {
      throw new Error("Desktop authentication returned no WebSocket ticket.");
    }
    url.searchParams.delete("token");
    url.searchParams.set("wsTicket", body.ticket);
    return url.href;
  } catch (cause) {
    sessions.delete(rawUrl);
    throw cause;
  }
}
