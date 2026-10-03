/**
 * Provider-aware external OAuth fallback.
 *
 * Implements a secure localhost loopback callback listener and PKCE generator
 * for OAuth providers (such as Google) that reject embedded user agents.
 * Ensures high-entropy one-time state, replay protection, strict path/origin
 * validation, short expiration, and clean teardown.
 */

import * as Crypto from "node:crypto";
import * as Http from "node:http";
import type { AddressInfo } from "node:net";

export interface PkcePair {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: "S256";
}

export function generatePkcePair(): PkcePair {
  // RFC 7636: 43 to 128 characters from unreserved characters
  const verifier = Crypto.randomBytes(48).toString("base64url").slice(0, 64);
  const challenge = Crypto.createHash("sha256").update(verifier).digest("base64url");
  return {
    codeVerifier: verifier,
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
  };
}

export function generateOneTimeState(): string {
  return Crypto.randomBytes(32).toString("hex");
}

export interface ExternalOAuthCallbackPayload {
  readonly code?: string | undefined;
  readonly error?: string | undefined;
  readonly errorDescription?: string | undefined;
}

export interface ExternalOAuthSessionOptions {
  readonly callbackPath?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface ExternalOAuthSessionResult {
  readonly status: "completed" | "cancelled" | "timedOut" | "error";
  readonly payload?: ExternalOAuthCallbackPayload | undefined;
  readonly error?: string | undefined;
  readonly durationMs: number;
}

export interface ExternalAuthReturnPathCheck {
  readonly canCompleteExternally: boolean;
  readonly reason: string;
  readonly suggestedAction?: "launchSystemBrowser" | "manualOpen" | undefined;
}

/**
 * Checks whether an arbitrary URL can be safely completed via an external system browser.
 */
export function verifyExternalAuthReturnPath(rawTargetUrl: string): ExternalAuthReturnPathCheck {
  let parsed: URL;
  try {
    parsed = new URL(rawTargetUrl);
  } catch {
    return {
      canCompleteExternally: false,
      reason: "Invalid URL.",
    };
  }

  const redirectUriParam =
    parsed.searchParams.get("redirect_uri") || parsed.searchParams.get("redirect_url");

  if (!redirectUriParam) {
    return {
      canCompleteExternally: false,
      reason:
        "This website does not expose an OAuth redirect parameter. Authentication cannot be returned automatically from an external browser.",
      suggestedAction: "manualOpen",
    };
  }

  try {
    const redirectUrl = new URL(redirectUriParam);
    const host = redirectUrl.hostname.toLowerCase();
    const isLoopback =
      host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host.startsWith("127.");

    if (isLoopback) {
      return {
        canCompleteExternally: true,
        reason: "OAuth client supports localhost loopback redirect.",
        suggestedAction: "launchSystemBrowser",
      };
    }

    if (redirectUrl.protocol === "tabs:" || redirectUrl.protocol === "vscode:") {
      return {
        canCompleteExternally: false,
        reason: `The ${redirectUrl.protocol} callback is not connected to a state-bound OAuth completion handler.`,
        suggestedAction: "manualOpen",
      };
    }

    return {
      canCompleteExternally: false,
      reason: `The previewed site's OAuth client only returns to ${redirectUrl.origin}. It cannot complete a desktop loopback handshake without an owned callback route.`,
      suggestedAction: "manualOpen",
    };
  } catch {
    return {
      canCompleteExternally: false,
      reason: "Unparseable OAuth redirect URI in target authorization request.",
      suggestedAction: "manualOpen",
    };
  }
}

/**
 * Ephemeral HTTP server bound strictly to 127.0.0.1 for receiving a single-use OAuth callback.
 */
export class EphemeralLoopbackOAuthServer {
  private server: Http.Server | null = null;
  private port: number | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private stateConsumed = false;
  private resolveSession: ((result: ExternalOAuthSessionResult) => void) | null = null;
  private startedAt = 0;

  readonly expectedState: string;
  readonly pkce: PkcePair;
  readonly callbackPath: string;
  readonly timeoutMs: number;

  constructor(options?: ExternalOAuthSessionOptions) {
    this.expectedState = generateOneTimeState();
    this.pkce = generatePkcePair();
    this.callbackPath = options?.callbackPath ?? "/callback";
    this.timeoutMs = options?.timeoutMs ?? 180_000; // 3 minutes
  }

  async start(): Promise<number> {
    if (this.server) {
      throw new Error("Loopback OAuth server is already running.");
    }

    this.startedAt = Date.now();

    return new Promise<number>((resolve, reject) => {
      const srv = Http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      // Bind strictly to loopback IPv4
      srv.listen(0, "127.0.0.1", () => {
        const address = srv.address() as AddressInfo;
        this.port = address.port;
        this.server = srv;

        this.timeoutTimer = setTimeout(() => {
          this.handleTimeout();
        }, this.timeoutMs);

        resolve(address.port);
      });

      srv.on("error", (err) => {
        reject(err);
      });
    });
  }

  getCallbackUrl(): string {
    if (this.port === null) {
      throw new Error("Loopback OAuth server is not started.");
    }
    return `http://127.0.0.1:${this.port}${this.callbackPath}`;
  }

  waitForResult(): Promise<ExternalOAuthSessionResult> {
    if (this.resolveSession) {
      throw new Error("Already waiting for OAuth result.");
    }
    return new Promise<ExternalOAuthSessionResult>((resolve) => {
      this.resolveSession = resolve;
    });
  }

  cancel(): void {
    if (this.resolveSession) {
      const durationMs = Date.now() - this.startedAt;
      const res = this.resolveSession;
      this.resolveSession = null;
      this.cleanup();
      res({
        status: "cancelled",
        durationMs,
      });
    } else {
      this.cleanup();
    }
  }

  private handleTimeout(): void {
    if (this.resolveSession) {
      const durationMs = Date.now() - this.startedAt;
      const res = this.resolveSession;
      this.resolveSession = null;
      this.cleanup();
      res({
        status: "timedOut",
        durationMs,
      });
    } else {
      this.cleanup();
    }
  }

  private handleRequest(req: Http.IncomingMessage, res: Http.ServerResponse): void {
    const rawUrl = req.url || "/";
    let parsed: URL;
    try {
      parsed = new URL(rawUrl, `http://127.0.0.1:${this.port}`);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Bad Request");
      return;
    }

    if (parsed.pathname !== this.callbackPath) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const stateParam = parsed.searchParams.get("state");
    const codeParam = parsed.searchParams.get("code") ?? undefined;
    const errorParam = parsed.searchParams.get("error") ?? undefined;
    const errorDescriptionParam = parsed.searchParams.get("error_description") ?? undefined;

    // Replay protection: each server instance only accepts exactly one callback with the correct state
    if (this.stateConsumed) {
      res.writeHead(409, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html>
<html>
<head><title>Authentication Replayed</title><style>body{font-family:system-ui,sans-serif;padding:3rem;line-height:1.5;background:#18181b;color:#f4f4f5}h1{color:#ef4444}</style></head>
<body>
<h1>Authentication Callback Already Consumed</h1>
<p>This authorization code or callback has already been processed. Return to Tabs.</p>
</body>
</html>`);
      return;
    }

    if (!stateParam || stateParam !== this.expectedState) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html>
<html>
<head><title>Invalid State</title><style>body{font-family:system-ui,sans-serif;padding:3rem;line-height:1.5;background:#18181b;color:#f4f4f5}h1{color:#ef4444}</style></head>
<body>
<h1>Authentication Failed: State Mismatch</h1>
<p>The state parameter did not match the expected one-time token. Return to Tabs and try again.</p>
</body>
</html>`);
      return;
    }

    this.stateConsumed = true;

    // Send friendly success response to the external browser
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Sign In Complete · Tabs</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #09090b;
      color: #fafafa;
    }
    .card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 12px;
      padding: 2.5rem;
      max-width: 420px;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }
    h1 {
      margin-top: 0;
      font-size: 1.5rem;
      color: #10b981;
    }
    p {
      color: #a1a1aa;
      font-size: 0.95rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>✓ Sign In Complete</h1>
    <p>You may close this browser tab and return to Tabs.</p>
  </div>
</body>
</html>`);

    const durationMs = Date.now() - this.startedAt;
    const resHandler = this.resolveSession;
    this.resolveSession = null;

    // Shut down server after delivery
    setImmediate(() => {
      this.cleanup();
    });

    if (resHandler) {
      resHandler({
        status: errorParam ? "error" : "completed",
        payload: {
          code: codeParam,
          error: errorParam,
          errorDescription: errorDescriptionParam,
        },
        error: errorParam ? errorDescriptionParam || errorParam : undefined,
        durationMs,
      });
    }
  }

  cleanup(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    if (this.server) {
      const srv = this.server;
      this.server = null;
      this.port = null;
      srv.close();
    }
  }
}
