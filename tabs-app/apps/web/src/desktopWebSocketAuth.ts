// Bootstrap credentials are exchanged over HTTP; only single-use tickets go on the socket URL.
const sessions = new Map<string, Promise<string>>();

async function requireJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw Object.assign(new Error(`Desktop authentication failed (HTTP ${response.status}).`), {
      status: response.status,
    });
  }
  return response.json();
}

function exchangeBootstrapToken(rawUrl: string, origin: string, bootstrapToken: string) {
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
    // A failed exchange must not poison later attempts.
    session.catch(() => sessions.delete(rawUrl));
  }
  return session;
}

function originOf(url: URL): string {
  const protocol = url.protocol === "wss:" ? "https:" : "http:";
  return `${protocol}//${url.host}`;
}

/** The desktop session's bearer token for HTTP calls, or null when the page authenticates by cookie. */
export async function desktopHttpAccessToken(rawUrl: string): Promise<string | null> {
  const url = new URL(rawUrl);
  const bootstrapToken = url.searchParams.get("token");
  if (!bootstrapToken) return null;
  return exchangeBootstrapToken(rawUrl, originOf(url), bootstrapToken);
}

export async function authorizeDesktopWebSocket(rawUrl: string): Promise<string> {
  const url = new URL(rawUrl);
  const bootstrapToken = url.searchParams.get("token");
  if (!bootstrapToken) return rawUrl;
  const origin = originOf(url);
  try {
    const accessToken = await exchangeBootstrapToken(rawUrl, origin, bootstrapToken);
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
