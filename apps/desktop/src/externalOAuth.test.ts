import { describe, expect, it } from "vitest";
import {
  EphemeralLoopbackOAuthServer,
  generateOneTimeState,
  generatePkcePair,
  verifyExternalAuthReturnPath,
} from "./externalOAuth";

describe("externalOAuth", () => {
  describe("PKCE and state generation", () => {
    it("generates 64-char verifier and valid base64url challenge", () => {
      const pkce = generatePkcePair();
      expect(pkce.codeVerifier.length).toBe(64);
      expect(pkce.codeChallengeMethod).toBe("S256");
      expect(pkce.codeChallenge.length).toBeGreaterThan(30);
      expect(pkce.codeChallenge).not.toContain("+");
      expect(pkce.codeChallenge).not.toContain("/");
    });

    it("generates high-entropy one-time states", () => {
      const s1 = generateOneTimeState();
      const s2 = generateOneTimeState();
      expect(s1).not.toBe(s2);
      expect(s1.length).toBe(64); // 32 bytes in hex
    });
  });

  describe("verifyExternalAuthReturnPath", () => {
    it("accepts localhost loopback redirect_uri", () => {
      const url =
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=xyz&redirect_uri=http://127.0.0.1:8080/callback";
      const check = verifyExternalAuthReturnPath(url);
      expect(check.canCompleteExternally).toBe(true);
      expect(check.suggestedAction).toBe("launchSystemBrowser");
    });

    it("rejects custom protocols until a state-bound handler is wired", () => {
      const url =
        "https://github.com/login/oauth/authorize?client_id=xyz&redirect_uri=tabs://oauth-callback";
      const check = verifyExternalAuthReturnPath(url);
      expect(check.canCompleteExternally).toBe(false);
      expect(check.suggestedAction).toBe("manualOpen");
    });

    it("honestly rejects third-party web domains that cannot complete to desktop", () => {
      const url =
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=xyz&redirect_uri=https://my-cloud-app.com/api/auth/callback";
      const check = verifyExternalAuthReturnPath(url);
      expect(check.canCompleteExternally).toBe(false);
      expect(check.reason).toContain("my-cloud-app.com");
      expect(check.suggestedAction).toBe("manualOpen");
    });

    it("rejects URLs without redirect parameters", () => {
      const url = "https://accounts.google.com/signin";
      const check = verifyExternalAuthReturnPath(url);
      expect(check.canCompleteExternally).toBe(false);
    });
  });

  describe("EphemeralLoopbackOAuthServer", () => {
    it("handles successful callback with matching state", async () => {
      const server = new EphemeralLoopbackOAuthServer({ timeoutMs: 5000 });
      const port = await server.start();
      expect(port).toBeGreaterThan(0);

      const callbackUrl = server.getCallbackUrl();
      expect(callbackUrl).toBe(`http://127.0.0.1:${port}/callback`);

      const promise = server.waitForResult();

      // Simulate browser returning from OAuth provider
      const response = await fetch(
        `http://127.0.0.1:${port}/callback?state=${server.expectedState}&code=auth_code_12345`,
      );
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("Sign In Complete");

      const result = await promise;
      expect(result.status).toBe("completed");
      expect(result.payload?.code).toBe("auth_code_12345");
    });

    it("rejects state mismatch with HTTP 400", async () => {
      const server = new EphemeralLoopbackOAuthServer({ timeoutMs: 5000 });
      const port = await server.start();

      const response = await fetch(`http://127.0.0.1:${port}/callback?state=wrong_state&code=fake`);
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain("State Mismatch");

      server.cleanup();
    });

    it("enforces replay protection against duplicate callback requests", async () => {
      const server = new EphemeralLoopbackOAuthServer({ timeoutMs: 5000 });
      const port = await server.start();
      const promise = server.waitForResult();

      const res1 = await fetch(
        `http://127.0.0.1:${port}/callback?state=${server.expectedState}&code=c1`,
      );
      expect(res1.status).toBe(200);
      await promise;

      // Duplicate request with the consumed state
      const res2 = await fetch(
        `http://127.0.0.1:${port}/callback?state=${server.expectedState}&code=c1`,
      ).catch(() => null);

      if (res2) {
        expect(res2.status).toBe(409);
      }
    });

    it("supports user cancellation", async () => {
      const server = new EphemeralLoopbackOAuthServer({ timeoutMs: 5000 });
      await server.start();
      const promise = server.waitForResult();

      server.cancel();
      const result = await promise;
      expect(result.status).toBe("cancelled");
    });

    it("handles timeout cleanly", async () => {
      const server = new EphemeralLoopbackOAuthServer({ timeoutMs: 50 });
      await server.start();
      const promise = server.waitForResult();

      const result = await promise;
      expect(result.status).toBe("timedOut");
    });
  });
});
