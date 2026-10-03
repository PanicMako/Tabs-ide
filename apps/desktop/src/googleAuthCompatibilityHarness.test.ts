import { describe, expect, it } from "vitest";
import { evaluateGoogleScenario } from "./googleAuthCompatibilityHarness";

describe("Google Authentication Compatibility Harness (10 Scenarios)", () => {
  it("Scenario 1: Direct navigation to accounts.google.com is permitted in embedded session", () => {
    const result = evaluateGoogleScenario(
      1,
      "Direct navigation to accounts.google.com",
      "https://accounts.google.com/",
      "Google Accounts",
    );
    expect(result.supportedInEmbedded).toBe(true);
    expect(result.externalFallbackRequired).toBe(false);
    expect(result.endpointCategory).toBe("direct_account_portal");
  });

  it("Scenario 2: Direct Google account session creation in partition is permitted", () => {
    const result = evaluateGoogleScenario(
      2,
      "Direct Google account session creation",
      "https://accounts.google.com/ServiceLogin",
      "Sign in - Google Accounts",
    );
    expect(result.supportedInEmbedded).toBe(true);
    expect(result.externalFallbackRequired).toBe(false);
    expect(result.endpointCategory).toBe("direct_account_portal");
  });

  it("Scenario 3: Google Identity Services (GIS) popup flow requires external fallback", () => {
    const result = evaluateGoogleScenario(
      3,
      "Google Identity Services popup flow",
      "https://accounts.google.com/gsi/client",
    );
    expect(result.supportedInEmbedded).toBe(false);
    expect(result.externalFallbackRequired).toBe(true);
    expect(result.endpointCategory).toBe("identity_services_gis");
  });

  it("Scenario 4: OAuth authorization endpoint routes appropriately without premature rejection", () => {
    const result = evaluateGoogleScenario(
      4,
      "OAuth authorization endpoint",
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=test&response_type=code",
    );
    expect(result.supportedInEmbedded).toBe(false);
    expect(result.externalFallbackRequired).toBe(true);
    expect(result.endpointCategory).toBe("oauth_authorization_prohibited");
    expect(result.rejectionDetails.isRejected).toBe(false);
  });

  it("Scenario 5: OAuth redirect flow routes to external browser", () => {
    const result = evaluateGoogleScenario(
      5,
      "OAuth redirect flow",
      "https://accounts.google.com/signin/oauth?client_id=test",
    );
    expect(result.supportedInEmbedded).toBe(false);
    expect(result.externalFallbackRequired).toBe(true);
  });

  it("Scenario 6: FedCM-dependent sign-in routes externally", () => {
    const result = evaluateGoogleScenario(
      6,
      "FedCM-dependent sign-in",
      "https://accounts.google.com/gsi/fedcm",
    );
    expect(result.supportedInEmbedded).toBe(false);
    expect(result.externalFallbackRequired).toBe(true);
  });

  it("Scenario 7: Third-party cookie restrictions route externally", () => {
    const result = evaluateGoogleScenario(
      7,
      "third-party cookie restrictions",
      "https://accounts.google.com/o/oauth2/auth",
    );
    expect(result.supportedInEmbedded).toBe(false);
    expect(result.externalFallbackRequired).toBe(true);
  });

  it("Scenario 8: Account chooser is permitted in direct embedded navigation", () => {
    const result = evaluateGoogleScenario(
      8,
      "account chooser",
      "https://accounts.google.com/AccountChooser",
    );
    expect(result.supportedInEmbedded).toBe(true);
    expect(result.externalFallbackRequired).toBe(false);
  });

  it("Scenario 9: Two-factor handoff within direct session is supported", () => {
    const result = evaluateGoogleScenario(
      9,
      "two-factor handoff",
      "https://accounts.google.com/v3/signin/challenge/pwd",
      "2-Step Verification",
    );
    expect(result.supportedInEmbedded).toBe(true);
    expect(result.externalFallbackRequired).toBe(false);
  });

  it("Scenario 10: Provider rejection (disallowed_useragent) is detected with honest compliance explanation", () => {
    const result = evaluateGoogleScenario(
      10,
      "provider rejection such as disallowed_useragent",
      "https://accounts.google.com/signin/oauth/error?error=disallowed_useragent",
      "403. That's an error. Error: disallowed_useragent",
    );
    expect(result.supportedInEmbedded).toBe(false);
    expect(result.externalFallbackRequired).toBe(true);
    expect(result.rejectionDetails.isRejected).toBe(true);
    expect(result.rejectionDetails.code).toBe("disallowed_useragent");
    expect(result.rejectionDetails.explanation).toContain("disallowed_useragent");
    expect(result.complianceDecision).toContain("Never spoof user agent");
  });
});
