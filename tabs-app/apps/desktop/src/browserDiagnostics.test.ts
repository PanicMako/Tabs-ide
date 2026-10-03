import { describe, expect, it } from "vitest";
import {
  BrowserAuthDiagnostics,
  sanitizeDiagnosticOrigin,
  sanitizeDiagnosticSummary,
} from "./browserDiagnostics";

describe("browserDiagnostics", () => {
  describe("sanitizeDiagnosticOrigin", () => {
    it("strips paths, query parameters, fragments, and auth codes completely", () => {
      const sensitiveUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?code=4%2F0AX4XfWh...&state=secret_state#access_token=ya29.xyz";
      const sanitized = sanitizeDiagnosticOrigin(sensitiveUrl);
      expect(sanitized).toBe("https://accounts.google.com");
      expect(sanitized).not.toContain("code=");
      expect(sanitized).not.toContain("state=");
      expect(sanitized).not.toContain("access_token=");
    });

    it("handles localhost with port safely", () => {
      expect(sanitizeDiagnosticOrigin("http://127.0.0.1:8080/callback?code=abc&state=123")).toBe(
        "http://127.0.0.1:8080",
      );
    });

    it("handles invalid or special inputs gracefully", () => {
      expect(sanitizeDiagnosticOrigin("about:blank")).toBe("about:blank");
      expect(sanitizeDiagnosticOrigin(null)).toBe("unknown");
      expect(sanitizeDiagnosticOrigin("not-a-valid-url")).toBe("invalid_origin");
    });
  });

  describe("sanitizeDiagnosticSummary", () => {
    it("redacts sensitive keys from summary messages", () => {
      const summary = "Received response with token: secret123 and code=auth_code_xyz";
      const sanitized = sanitizeDiagnosticSummary(summary);
      expect(sanitized).toContain("token: [REDACTED]");
      expect(sanitized).toContain("code=[REDACTED]");
      expect(sanitized).not.toContain("secret123");
      expect(sanitized).not.toContain("auth_code_xyz");
    });
  });

  describe("BrowserAuthDiagnostics ring buffer and reporting", () => {
    it("records diagnostic entries with sanitized origin and bounded capacity", () => {
      const diagnostics = new BrowserAuthDiagnostics(3);

      diagnostics.record({
        profileId: "work",
        provider: "github",
        stage: "navigation_initiated",
        navigationType: "will_navigate",
        rawUrl: "https://github.com/login/oauth/authorize?client_id=xyz&code=abc",
        outcome: "in_progress",
      });

      diagnostics.record({
        profileId: "work",
        provider: "github",
        stage: "popup_opened",
        navigationType: "new_window",
        rawUrl: "https://github.com/login/oauth/authorize?client_id=xyz",
        outcome: "in_progress",
      });

      diagnostics.record({
        profileId: "work",
        provider: "github",
        stage: "completed",
        navigationType: "in_page",
        rawUrl: "https://my-app.com/callback?code=super_secret",
        outcome: "completed",
      });

      let entries = diagnostics.getEntries();
      expect(entries.length).toBe(3);
      expect(entries[0]!.sanitizedOrigin).toBe("https://github.com");
      expect(entries[2]!.sanitizedOrigin).toBe("https://my-app.com");

      // Test buffer overflow (drops oldest entry)
      diagnostics.record({
        profileId: "work",
        provider: "google",
        stage: "external_fallback_initiated",
        navigationType: "external_browser",
        rawUrl: "https://accounts.google.com/o/oauth2/auth",
        outcome: "in_progress",
      });

      entries = diagnostics.getEntries();
      expect(entries.length).toBe(3);
      expect(entries[0]!.stage).toBe("popup_opened");
      expect(entries[2]!.provider).toBe("google");
    });

    it("generates markdown summary without leaking secrets", () => {
      const diagnostics = new BrowserAuthDiagnostics(10);
      diagnostics.record({
        profileId: "dev",
        provider: "clerk",
        stage: "completed",
        navigationType: "in_page",
        rawUrl: "https://clerk.accounts.dev/sign-in?redirect_url=foo",
        outcome: "completed",
      });

      const summary = diagnostics.formatBugReportSummary();
      expect(summary).toContain("Tabs Browser Authentication Diagnostics Summary");
      expect(summary).toContain("clerk.accounts.dev");
      expect(summary).toContain("completed");
      expect(summary).not.toContain("redirect_url");
    });
  });
});
