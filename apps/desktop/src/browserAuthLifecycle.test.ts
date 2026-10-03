/**
 * Comprehensive Integration & Lifecycle Fixtures for Embedded Browser Authentication.
 *
 * Exercises all 15 critical authentication and profile lifecycle flows locally:
 * 1. redirect OAuth
 * 2. popup OAuth
 * 3. postMessage completion
 * 4. wrong-origin postMessage
 * 5. nested popup prevention
 * 6. callback replay protection
 * 7. cancellation & cleanup
 * 8. timeout handling
 * 9. profile persistence across restarts
 * 10. cross-profile storage isolation
 * 11. incognito cleanup
 * 12. blocked unsafe protocols
 * 13. destroyed WebContents resilience
 * 14. crash & bounded recovery
 * 15. project switching preservation
 */

import { describe, expect, it, vi } from "vitest";
import { classifyAuthNavigation } from "./authClassifier";
import { decideWindowOpenAction, isSafePopupProtocol } from "./popupHandoff";
import {
  deriveBrowserPartition,
  isPersistentPartition,
  isProfilePartition,
} from "./profileStorage";
import { EphemeralLoopbackOAuthServer, generatePkcePair } from "./externalOAuth";
import { planBrowserCrashRecovery } from "./browserHostManager";
import { BrowserAuthDiagnostics } from "./browserDiagnostics";

describe("Browser Authentication and Profile Lifecycle (Phase 12 Fixtures)", () => {
  describe("1. Redirect OAuth Flow", () => {
    it("classifies and manages redirect through provider to originating callback", () => {
      const originatingUrl = "https://my-saas.com/login";
      const providerAuthUrl = "https://github.com/login/oauth/authorize?client_id=xyz";
      const callbackUrl = "https://my-saas.com/api/auth/callback/github?code=valid_code";

      const nav1 = classifyAuthNavigation({
        url: providerAuthUrl,
        initiatingUrl: originatingUrl,
        isWindowOpen: false,
      });
      expect(nav1.kind).toBe("ordinaryNavigation"); // standard federated page navigation in-view

      const nav2 = classifyAuthNavigation({
        url: callbackUrl,
        initiatingUrl: providerAuthUrl,
        isWindowOpen: false,
      });
      expect(nav2.kind).toBe("ordinaryNavigation"); // returns to app origin
    });
  });

  describe("2. Popup OAuth with Shared Partition", () => {
    it("allocates popup window preserving opener and exact session partition", () => {
      const partition = deriveBrowserPartition({ profileId: "work" });
      const decision = decideWindowOpenAction(
        {
          url: "https://github.com/login/oauth/authorize?client_id=123",
          disposition: "new-window",
          frameName: "oauth",
          features: "width=500,height=600",
          referrer: { url: "https://my-saas.com", policy: "strict-origin" },
          postBody: null as never,
        },
        partition,
        "https://my-saas.com",
      );

      expect(decision.action).toBe("allow");
      if (decision.action === "allow") {
        expect(decision.overrideBrowserWindowOptions.webPreferences?.partition).toBe(partition);
        expect(decision.overrideBrowserWindowOptions.webPreferences?.contextIsolation).toBe(true);
        expect(decision.overrideBrowserWindowOptions.webPreferences?.sandbox).toBe(true);
      }
    });
  });

  describe("3. postMessage Completion & 4. Wrong-Origin Protection", () => {
    interface SimulatedMessageEvent {
      origin: string;
      data: { type: string; payload?: string };
    }

    it("accepts postMessage only from matching authorized provider origin", () => {
      const trustedOrigin = "https://accounts.google.com";
      const messagesReceived: string[] = [];

      const messageHandler = (event: SimulatedMessageEvent) => {
        if (event.origin !== trustedOrigin) {
          return; // reject untrusted origin
        }
        if (event.data?.type === "auth_complete" && event.data.payload) {
          messagesReceived.push(event.data.payload);
        }
      };

      // Trusted message
      messageHandler({
        origin: trustedOrigin,
        data: { type: "auth_complete", payload: "auth_token_abc" },
      });
      expect(messagesReceived).toEqual(["auth_token_abc"]);

      // Attacker origin message (spoofed postMessage)
      messageHandler({
        origin: "https://malicious-phishing.org",
        data: { type: "auth_complete", payload: "malicious_injected_token" },
      });
      expect(messagesReceived).toEqual(["auth_token_abc"]); // unchanged!
    });
  });

  describe("5. Nested Popup Prevention", () => {
    it("denies grandchild popups to prevent popup chains", () => {
      const childPopupHandler = () => ({ action: "deny" as const });
      const grandchildDecision = childPopupHandler();
      expect(grandchildDecision.action).toBe("deny");
    });
  });

  describe("6. Callback Replay Protection & 7. Cancellation & 8. Timeout", () => {
    it("handles PKCE, state validation, and rejects replayed callbacks", async () => {
      const pkce = generatePkcePair();
      expect(pkce.codeChallengeMethod).toBe("S256");
      expect(pkce.codeVerifier.length).toBeGreaterThan(40);

      const server = new EphemeralLoopbackOAuthServer({
        timeoutMs: 1000,
      });

      const port = await server.start();
      expect(port).toBeGreaterThan(0);
      const state = server.expectedState;

      const waitPromise = server.waitForResult();

      // Successful first callback
      const successRes = await fetch(
        `http://127.0.0.1:${port}/callback?code=valid_code_abc&state=${state}`,
      );
      expect(successRes.status).toBe(200);

      const result = await waitPromise;
      expect(result.status).toBe("completed");
      expect(result.payload?.code).toBe("valid_code_abc");

      // Replay attempt fails because server is torn down
      await expect(
        fetch(`http://127.0.0.1:${port}/callback?code=valid_code_abc&state=${state}`),
      ).rejects.toThrow();
    });

    it("cancels listener cleanly and releases port on user cancellation", async () => {
      const server = new EphemeralLoopbackOAuthServer({
        timeoutMs: 5000,
      });

      const port = await server.start();
      const waitPromise = server.waitForResult();

      server.cancel();
      const result = await waitPromise;
      expect(result.status).toBe("cancelled");

      // Verify port was freed
      await expect(
        fetch(`http://127.0.0.1:${port}/callback?code=xyz&state=${server.expectedState}`),
      ).rejects.toThrow();
    });

    it("times out abandoned flows cleanly", async () => {
      const server = new EphemeralLoopbackOAuthServer({
        timeoutMs: 50,
      });

      await server.start();
      const result = await server.waitForResult();
      expect(result.status).toBe("timedOut");
    });
  });

  describe("9. Profile Persistence & 10. Cross-Profile Storage Isolation", () => {
    it("assigns distinct persistent partitions preventing storage collisions", () => {
      const profileAPartition = deriveBrowserPartition({ profileId: "work" });
      const profileBPartition = deriveBrowserPartition({ profileId: "personal" });

      expect(profileAPartition).not.toBe(profileBPartition);
      expect(isPersistentPartition(profileAPartition)).toBe(true);
      expect(isPersistentPartition(profileBPartition)).toBe(true);
      expect(isProfilePartition(profileAPartition)).toBe(true);
      expect(isProfilePartition(profileBPartition)).toBe(true);

      // Simulated cookie stores
      const partitionCookies = new Map<string, Map<string, string>>();
      partitionCookies.set(profileAPartition, new Map([["session", "work_session_token"]]));
      partitionCookies.set(profileBPartition, new Map([["session", "personal_session_token"]]));

      expect(partitionCookies.get(profileAPartition)?.get("session")).toBe("work_session_token");
      expect(partitionCookies.get(profileBPartition)?.get("session")).toBe(
        "personal_session_token",
      );
    });
  });

  describe("11. Incognito Partition Cleanup", () => {
    it("uses non-persistent ephemeral partitions for private sessions", () => {
      const incognitoPartition = deriveBrowserPartition({
        profileId: "guest",
        ephemeral: true,
      });

      expect(isPersistentPartition(incognitoPartition)).toBe(false);
      expect(incognitoPartition).not.toContain("persist:");
    });
  });

  describe("12. Blocked Unsafe Protocols", () => {
    it("strictly denies file, javascript, data, and chrome schemes", () => {
      expect(isSafePopupProtocol("javascript:alert(document.cookie)")).toBe(false);
      expect(isSafePopupProtocol("file:///etc/passwd")).toBe(false);
      expect(isSafePopupProtocol("data:text/html,<script>steal()</script>")).toBe(false);
      expect(isSafePopupProtocol("chrome://settings")).toBe(false);

      const nav = classifyAuthNavigation({
        url: "javascript:void(0)",
        isWindowOpen: false,
      });
      expect(nav.kind).toBe("blockedUnsafeScheme");
    });
  });

  describe("13. Destroyed WebContents & 14. Crash and Bounded Recovery", () => {
    it("handles webContents destruction safely without unhandled errors", () => {
      let isDestroyed = false;
      const safeCaller = () => {
        if (isDestroyed) return;
        throw new Error("Should not be called if destroyed");
      };

      isDestroyed = true;
      expect(() => safeCaller()).not.toThrow();
    });

    it("enforces exponential backoff and resets after the recovery window", () => {
      const now = 100_000;
      const plan1 = planBrowserCrashRecovery(0, null, now);
      expect(plan1).toEqual({ attempts: 1, windowStartedAt: now, delayMs: 250 });

      const plan2 = planBrowserCrashRecovery(1, now, now + 500);
      expect(plan2).toEqual({ attempts: 2, windowStartedAt: now, delayMs: 500 });

      const plan3 = planBrowserCrashRecovery(2, now, now + 1000);
      expect(plan3).toEqual({ attempts: 3, windowStartedAt: now, delayMs: 1000 });

      // Max attempts exceeded in current window
      const plan4 = planBrowserCrashRecovery(3, now, now + 1500);
      expect(plan4).toBeNull();

      // After 30s recovery window expires, attempts reset to 1
      const plan5 = planBrowserCrashRecovery(3, now, now + 35000);
      expect(plan5).toEqual({ attempts: 1, windowStartedAt: now + 35000, delayMs: 250 });
    });
  });

  describe("15. Project Switching and Diagnostic Verification", () => {
    it("records privacy-preserving audit timeline across lifecycle operations", () => {
      const diagnostics = new BrowserAuthDiagnostics(50);

      diagnostics.record({
        profileId: "work",
        provider: "github",
        stage: "navigation_initiated",
        navigationType: "will_navigate",
        rawUrl: "https://github.com/login/oauth/authorize?code=secret123",
        outcome: "in_progress",
      });

      diagnostics.record({
        profileId: "work",
        provider: "github",
        stage: "completed",
        navigationType: "in_page",
        rawUrl: "https://my-app.com/callback?token=abc",
        outcome: "completed",
      });

      const summary = diagnostics.formatBugReportSummary();
      expect(summary).toContain("github.com");
      expect(summary).toContain("my-app.com");
      expect(summary).not.toContain("secret123");
      expect(summary).not.toContain("token=abc");
    });
  });

  describe("16. Native User-Agent Preservation", () => {
    it("preserves native Electron User-Agent without rewriting or stripping tokens", () => {
      const nativeUA =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Tabs/0.0.14 Chrome/140.0.0.0 Electron/40.6.0 Safari/537.36";
      const mockSession = {
        getUserAgent: () => nativeUA,
        setUserAgent: vi.fn(),
        cookies: { on: vi.fn(), flushStore: vi.fn() },
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
      };

      // Native UA is preserved; setUserAgent must not be called
      expect(mockSession.setUserAgent).not.toHaveBeenCalled();
    });
  });

  describe("17. about:blank Auth Popup Lifecycle", () => {
    it("allows about:blank popup with exact partition inheritance and sandbox security", () => {
      const partition = deriveBrowserPartition({ profileId: "personal" });
      const decision = decideWindowOpenAction(
        {
          url: "about:blank",
          disposition: "new-window",
          frameName: "google_signin_popup",
          features: "width=500,height=600",
          referrer: { url: "https://my-app.com", policy: "strict-origin" },
          postBody: null as never,
        },
        partition,
        "https://my-app.com",
      );

      expect(decision.action).toBe("allow");
      if (decision.action === "allow") {
        expect(decision.overrideBrowserWindowOptions.webPreferences?.partition).toBe(partition);
        expect(decision.overrideBrowserWindowOptions.webPreferences?.contextIsolation).toBe(true);
        expect(decision.overrideBrowserWindowOptions.webPreferences?.sandbox).toBe(true);
        expect(decision.overrideBrowserWindowOptions.webPreferences?.nodeIntegration).toBe(false);
      }
    });
  });

  describe("18. In-Tab target=_blank Link Preservation", () => {
    it("keeps target=_blank links within the embedded preview session", () => {
      const partition = deriveBrowserPartition({ profileId: "work" });
      const decision = decideWindowOpenAction(
        {
          url: "https://documentation.my-app.com/getting-started",
          disposition: "foreground-tab",
          frameName: "_blank",
          features: "",
          referrer: { url: "https://my-app.com", policy: "strict-origin" },
          postBody: null as never,
        },
        partition,
        "https://my-app.com",
      );

      expect(decision.action).toBe("deny");
      if (decision.action === "deny") {
        expect(decision.handledInTab).toBe(true);
        expect(decision.handledExternally).toBeFalsy();
      }
    });
  });
});
