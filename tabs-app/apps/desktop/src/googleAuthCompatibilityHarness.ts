/**
 * Local Compatibility Test Harness for Google Authentication Scenarios.
 *
 * Implements synthetic, credential-free validation of all 10 authentication
 * interaction categories defined in Phase 9 without making external network calls
 * or handling real credentials.
 */

import {
  classifyGoogleEndpoint,
  detectGoogleRejection,
  type GoogleEndpointCategory,
  type GoogleRejectionDetails,
} from "./googleAuthHandler";

export interface GoogleAuthScenarioResult {
  readonly scenarioIndex: number;
  readonly category: string;
  readonly url: string;
  readonly endpointCategory: GoogleEndpointCategory;
  readonly rejectionDetails: GoogleRejectionDetails;
  readonly supportedInEmbedded: boolean;
  readonly externalFallbackRequired: boolean;
  readonly complianceDecision: string;
}

export function evaluateGoogleScenario(
  index: number,
  category: string,
  url: string,
  pageTitle?: string,
): GoogleAuthScenarioResult {
  const endpointCategory = classifyGoogleEndpoint(url);
  const rejectionDetails = detectGoogleRejection(url, pageTitle);

  let supportedInEmbedded = false;
  let externalFallbackRequired = false;
  let complianceDecision = "";

  switch (index) {
    case 1: // Direct navigation to accounts.google.com
      supportedInEmbedded = true;
      externalFallbackRequired = false;
      complianceDecision = "Direct account portal navigation is permitted in embedded session.";
      break;

    case 2: // Direct Google account session creation
      supportedInEmbedded = true;
      externalFallbackRequired = false;
      complianceDecision = "Session creation within user profile partition is permitted.";
      break;

    case 3: // Google Identity Services (GIS) popup flow
      supportedInEmbedded = false;
      externalFallbackRequired = true;
      complianceDecision =
        "GIS popups that trigger OAuth authorization require external browser handoff.";
      break;

    case 4: // OAuth authorization endpoint
      supportedInEmbedded = false;
      externalFallbackRequired = true;
      complianceDecision =
        "OAuth authorization endpoints strictly require external system browser.";
      break;

    case 5: // OAuth redirect flow
      supportedInEmbedded = false;
      externalFallbackRequired = true;
      complianceDecision =
        "Redirect flows to accounts.google.com/o/oauth2/v2/auth require external fallback.";
      break;

    case 6: // FedCM-dependent sign-in
      supportedInEmbedded = false;
      externalFallbackRequired = true;
      complianceDecision =
        "FedCM (Federated Credential Management) requires system browser environment.";
      break;

    case 7: // Third-party cookie restrictions
      supportedInEmbedded = false;
      externalFallbackRequired = true;
      complianceDecision =
        "Third-party cookie partitioning prevents cross-site embedded iframe auth.";
      break;

    case 8: // Account chooser
      supportedInEmbedded = true;
      externalFallbackRequired = false;
      complianceDecision = "Direct account chooser navigation is permitted.";
      break;

    case 9: // Two-factor handoff
      supportedInEmbedded = true;
      externalFallbackRequired = false;
      complianceDecision = "2FA verification within direct portal session is preserved.";
      break;

    case 10: // Provider rejection (disallowed_useragent)
      supportedInEmbedded = false;
      externalFallbackRequired = true;
      complianceDecision =
        "Never spoof user agent. Display honest explanation and system browser option.";
      break;

    default:
      supportedInEmbedded = false;
      externalFallbackRequired = true;
      complianceDecision = "Default to external fallback.";
  }

  return {
    scenarioIndex: index,
    category,
    url,
    endpointCategory,
    rejectionDetails,
    supportedInEmbedded,
    externalFallbackRequired,
    complianceDecision,
  };
}
