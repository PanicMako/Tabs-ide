import { describe, expect, it } from "vitest";
import { classifyGoogleEndpoint, detectGoogleRejection } from "./googleAuthHandler";

describe("googleAuthHandler", () => {
  describe("classifyGoogleEndpoint", () => {
    it("recognizes direct account portals", () => {
      expect(classifyGoogleEndpoint("https://accounts.google.com/ServiceLogin")).toBe(
        "direct_account_portal",
      );
      expect(classifyGoogleEndpoint("https://accounts.google.com/v3/signin/identifier")).toBe(
        "direct_account_portal",
      );
      expect(classifyGoogleEndpoint("https://accounts.google.com/AccountChooser")).toBe(
        "direct_account_portal",
      );
    });

    it("recognizes prohibited OAuth 2.0 authorization endpoints", () => {
      expect(
        classifyGoogleEndpoint(
          "https://accounts.google.com/o/oauth2/v2/auth?client_id=123&response_type=code",
        ),
      ).toBe("oauth_authorization_prohibited");
      expect(classifyGoogleEndpoint("https://accounts.google.com/signin/oauth?client_id=123")).toBe(
        "oauth_authorization_prohibited",
      );
    });

    it("recognizes Google Identity Services endpoints", () => {
      expect(classifyGoogleEndpoint("https://accounts.google.com/gsi/client")).toBe(
        "identity_services_gis",
      );
    });

    it("recognizes explicit disallowed_useragent error parameters", () => {
      expect(
        classifyGoogleEndpoint(
          "https://accounts.google.com/signin/oauth/error?error=disallowed_useragent",
        ),
      ).toBe("disallowed_useragent_error");
    });

    it("treats non-Google hosts as other", () => {
      expect(classifyGoogleEndpoint("https://github.com/login")).toBe("other_google_service");
      expect(classifyGoogleEndpoint("invalid-url")).toBe("other_google_service");
    });
  });

  describe("detectGoogleRejection", () => {
    it("identifies disallowed_useragent errors with compliant user explanation", () => {
      const rejection = detectGoogleRejection(
        "https://accounts.google.com/signin/oauth/error?error=disallowed_useragent",
      );
      expect(rejection.isRejected).toBe(true);
      expect(rejection.code).toBe("disallowed_useragent");
      expect(rejection.title).toContain("Google Authentication Blocked");
      expect(rejection.explanation).toContain("disallowed_useragent");
      expect(rejection.explanation).toContain("default system browser");
    });

    it("identifies 403 error page titles as rejection", () => {
      const rejection = detectGoogleRejection(
        "https://accounts.google.com/signin/v2/challenge",
        "403. That's an error. Error: disallowed_useragent",
      );
      expect(rejection.isRejected).toBe(true);
      expect(rejection.code).toBe("disallowed_useragent");
    });

    it("permits standard OAuth authorization endpoints without premature rejection", () => {
      const rejection = detectGoogleRejection(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=xyz",
        "Sign in - Google Accounts",
      );
      expect(rejection.isRejected).toBe(false);
      expect(rejection.code).toBe("none");
    });

    it("permits direct account login without rejection", () => {
      const rejection = detectGoogleRejection(
        "https://accounts.google.com/v3/signin/identifier",
        "Sign in - Google Accounts",
      );
      expect(rejection.isRejected).toBe(false);
      expect(rejection.code).toBe("none");
    });
  });
});
