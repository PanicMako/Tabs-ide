/**
 * Google Authentication Policy & Rejection Handler.
 *
 * Implements strict compliance with Google's OAuth 2.0 Policies:
 * Google explicitly prohibits embedded webviews (Electron, WebContentsView)
 * from performing OAuth 2.0 authorization to protect users from credential interception.
 *
 * Compliance invariants:
 * 1. NEVER forge Chrome branding or client hints to bypass disallowed_useragent.
 * 2. NEVER inject scripts into Google login pages.
 * 3. Clearly explain to the user why Google rejects embedded authorization.
 * 4. Provide a secure, seamless external browser handoff for prohibited flows.
 */

export type GoogleEndpointCategory =
  | "direct_account_portal"
  | "oauth_authorization_prohibited"
  | "identity_services_gis"
  | "disallowed_useragent_error"
  | "other_google_service";

export interface GoogleRejectionDetails {
  readonly isRejected: boolean;
  readonly code: "disallowed_useragent" | "embedded_oauth_blocked" | "none";
  readonly title: string;
  readonly explanation: string;
  readonly externalUrl: string;
}

export function classifyGoogleEndpoint(rawUrl: string): GoogleEndpointCategory {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return "other_google_service";
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.endsWith(".google.com") && hostname !== "google.com") {
    return "other_google_service";
  }

  const pathname = parsed.pathname.toLowerCase();
  const searchParams = parsed.searchParams;

  // 1. Explicit error 403 disallowed_useragent
  if (
    searchParams.get("error") === "disallowed_useragent" ||
    searchParams.get("error_subtype") === "disallowed_useragent" ||
    pathname.includes("disallowed_useragent")
  ) {
    return "disallowed_useragent_error";
  }

  // 2. Google OAuth 2.0 authorization endpoints that reject embedded user agents
  if (
    hostname === "accounts.google.com" &&
    (pathname.startsWith("/o/oauth2/v2/auth") ||
      pathname.startsWith("/o/oauth2/auth") ||
      pathname.startsWith("/signin/oauth"))
  ) {
    return "oauth_authorization_prohibited";
  }

  // 3. Google Identity Services (GIS) / One Tap
  if (hostname === "accounts.google.com" && pathname.startsWith("/gsi/")) {
    return "identity_services_gis";
  }

  // 4. Direct account management / session creation (ServiceLogin, AddSession, AccountChooser)
  if (
    hostname === "accounts.google.com" &&
    (pathname.startsWith("/servicelogin") ||
      pathname.startsWith("/v3/signin") ||
      pathname.startsWith("/accountchooser") ||
      pathname.startsWith("/addsession") ||
      pathname === "/" ||
      pathname === "")
  ) {
    return "direct_account_portal";
  }

  return "other_google_service";
}

/**
 * Detects whether a navigation or page load represents Google's `disallowed_useragent`
 * rejection, and provides human-readable compliance explanation.
 */
export function detectGoogleRejection(
  rawUrl: string,
  pageTitle?: string | null | undefined,
): GoogleRejectionDetails {
  const category = classifyGoogleEndpoint(rawUrl);

  const titleLower = (pageTitle ?? "").toLowerCase();
  const isGoogleHost = (() => {
    try {
      const h = new URL(rawUrl.trim()).hostname.toLowerCase();
      return h === "google.com" || h.endsWith(".google.com");
    } catch {
      return false;
    }
  })();

  const hasExplicitProviderRejection =
    category === "disallowed_useragent_error" ||
    (isGoogleHost && titleLower.includes("disallowed_useragent"));

  if (hasExplicitProviderRejection) {
    return {
      isRejected: true,
      code: "disallowed_useragent",
      title: "Google Authentication Blocked (Embedded Browser)",
      explanation:
        "Google prohibits OAuth 2.0 authorization inside developer-controlled embedded user agents (such as Electron) to prevent credential interception (Google Error 403: disallowed_useragent). Tabs complies with this security policy and does not bypass it through user-agent spoofing. Please complete sign-in using your default system browser.",
      externalUrl: rawUrl,
    };
  }

  return {
    isRejected: false,
    code: "none",
    title: "",
    explanation: "",
    externalUrl: rawUrl,
  };
}
