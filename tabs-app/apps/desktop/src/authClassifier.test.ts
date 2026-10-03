import { describe, expect, it } from "vitest";
import {
  classifyAuthNavigation,
  hasSameRegistrableOrigin,
  isLoopbackHostname,
  sanitizeAuthUrl,
} from "./authClassifier";

describe("authClassifier", () => {
  describe("sanitizeAuthUrl", () => {
    it("strips query parameters and fragments", () => {
      const url =
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=123&token=secret#access_token=xyz";
      expect(sanitizeAuthUrl(url)).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    });

    it("handles invalid URLs cleanly", () => {
      expect(sanitizeAuthUrl("not a url")).toBe("[invalid-url]");
    });
  });

  describe("isLoopbackHostname", () => {
    it("identifies 127.0.0.1, localhost, and ipv6 loopback", () => {
      expect(isLoopbackHostname("127.0.0.1")).toBe(true);
      expect(isLoopbackHostname("localhost")).toBe(true);
      expect(isLoopbackHostname("[::1]")).toBe(true);
      expect(isLoopbackHostname("sub.localhost")).toBe(true);
      expect(isLoopbackHostname("127.0.1.5")).toBe(true);
      expect(isLoopbackHostname("0.0.0.0")).toBe(false);
      expect(isLoopbackHostname("example.com")).toBe(false);
    });
  });

  describe("hasSameRegistrableOrigin", () => {
    it("requires an exact web origin including scheme, host, and port", () => {
      expect(
        hasSameRegistrableOrigin("https://example.com/page", "https://example.com/login"),
      ).toBe(true);
      expect(
        hasSameRegistrableOrigin("https://example.com/page", "https://www.example.com/login"),
      ).toBe(false);
      expect(hasSameRegistrableOrigin("https://example.com/page", "http://example.com/login")).toBe(
        false,
      );
      expect(
        hasSameRegistrableOrigin("https://example.com:8443", "https://example.com:9443/login"),
      ).toBe(false);
      expect(hasSameRegistrableOrigin("https://example.com", "https://other.com")).toBe(false);
    });
  });

  describe("classifyAuthNavigation", () => {
    it("blocks unsafe schemes", () => {
      const schemes = [
        "file:///etc/passwd",
        "javascript:alert(1)",
        "data:text/html,<h1>hi</h1>",
        "chrome://settings",
        "electron://app",
      ];
      for (const url of schemes) {
        const result = classifyAuthNavigation({ url });
        expect(result.kind).toBe("blockedUnsafeScheme");
      }
    });

    it("blocks protocols that are not owned callback schemes", () => {
      for (const url of [
        "tabs://oauth-callback?code=abc",
        "vscode://settings",
        "mailto:user@example.com",
        "ssh://host",
      ]) {
        expect(classifyAuthNavigation({ url }).kind).toBe("blockedUnsafeScheme");
      }
    });

    it("identifies loopback callbacks", () => {
      const result = classifyAuthNavigation({
        url: "http://127.0.0.1:45678/auth/callback?code=xyz",
      });
      expect(result.kind).toBe("loopbackCallback");
      expect(result.port).toBe(45678);
    });

    it("allows Google OAuth 2.0 authorization endpoints in ordinary embedded navigation or popups", () => {
      const result = classifyAuthNavigation({
        url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=foo&redirect_uri=bar",
      });
      expect(result.kind).toBe("ordinaryNavigation");

      const popup = classifyAuthNavigation({
        url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=foo&redirect_uri=bar",
        isWindowOpen: true,
      });
      expect(popup.kind).toBe("embeddedPopupCandidate");
      expect(popup.provider).toBe("google");
    });

    it("allows direct Google account browsing in samePartitionLoginWindow or ordinary navigation", () => {
      const direct = classifyAuthNavigation({
        url: "https://accounts.google.com/signin/v2/identifier",
        initiatingUrl: null,
      });
      expect(direct.kind).toBe("ordinaryNavigation");

      const profileIntent = classifyAuthNavigation({
        url: "https://accounts.google.com",
        profileLoginIntent: true,
      });
      expect(profileIntent.kind).toBe("samePartitionLoginWindow");
      expect(profileIntent.provider).toBe("google");
    });

    it("identifies scripted popup candidates on federated auth providers", () => {
      const githubPopup = classifyAuthNavigation({
        url: "https://github.com/login/oauth/authorize?client_id=123",
        disposition: "new-window",
        isWindowOpen: true,
      });
      expect(githubPopup.kind).toBe("embeddedPopupCandidate");
      expect(githubPopup.provider).toBe("github");

      const msPopup = classifyAuthNavigation({
        url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        disposition: "new-window",
      });
      expect(msPopup.kind).toBe("embeddedPopupCandidate");
      expect(msPopup.provider).toBe("microsoft");

      const clerkPopup = classifyAuthNavigation({
        url: "https://clerk.myapp.com/oauth/authorize",
        disposition: "new-window",
      });
      expect(clerkPopup.kind).toBe("embeddedPopupCandidate");
      expect(clerkPopup.provider).toBe("clerk");
    });

    it("avoids false positives on ordinary websites with /login, /auth, /signin in path", () => {
      const blogLogin = classifyAuthNavigation({
        url: "https://myblog.com/login",
        initiatingUrl: "https://myblog.com/",
      });
      expect(blogLogin.kind).toBe("ordinaryNavigation");

      const docsAuth = classifyAuthNavigation({
        url: "https://docs.site.dev/guide/auth/setup",
      });
      expect(docsAuth.kind).toBe("ordinaryNavigation");

      const githubIssue = classifyAuthNavigation({
        url: "https://github.com/org/repo/issues/123",
      });
      expect(githubIssue.kind).toBe("ordinaryNavigation");
    });
  });
});
