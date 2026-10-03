/**
 * Safe classification of browser navigation and authentication flows.
 *
 * Replaces blunt regex heuristics (which falsely treated any URL with `/login`
 * or `/auth` as an OAuth flow) with a structured model that accounts for
 * protocol, hostname, provider, disposition, initiating origin, and opener needs.
 */

export type AuthClassificationKind =
  | "ordinaryNavigation"
  | "embeddedPopupCandidate"
  | "externalOAuthRequired"
  | "samePartitionLoginWindow"
  | "loopbackCallback"
  | "customSchemeCallback"
  | "blockedUnsafeScheme";

export interface AuthClassificationResult {
  readonly kind: AuthClassificationKind;
  readonly reason: string;
  readonly provider?: string | undefined;
  readonly sanitizedUrl: string;
  readonly scheme: string;
  readonly hostname?: string | undefined;
  readonly port?: number | undefined;
}

export interface AuthNavigationRequest {
  readonly url: string;
  readonly initiatingUrl?: string | null | undefined;
  readonly disposition?:
    | "default"
    | "new-window"
    | "foreground-tab"
    | "background-tab"
    | "other"
    | undefined;
  readonly isWindowOpen?: boolean | undefined;
  readonly profileLoginIntent?: boolean | undefined;
}

const BLOCKED_UNSAFE_SCHEMES = new Set([
  "file:",
  "javascript:",
  "data:",
  "vbscript:",
  "chrome:",
  "devtools:",
  "electron:",
]);

const ALLOWED_WEB_SCHEMES = new Set(["http:", "https:"]);
// Add a scheme only after the desktop main process has a state-bound OAuth
// callback handler for it. Merely registering a protocol with the OS is not enough.
const ALLOWED_CALLBACK_SCHEMES = new Set<string>();

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * Providers whose OAuth 2.0 authorization endpoints strictly require external browser
 * handoff (e.g. explicit provider redirect parameters).
 */
const EXTERNAL_OAUTH_PROVIDERS: ReadonlyArray<{
  readonly name: string;
  readonly matches: (parsed: URL) => boolean;
}> = [];

/**
 * Known federated authentication providers and endpoints.
 */
const KNOWN_AUTH_PROVIDERS: ReadonlyArray<{
  readonly name: string;
  readonly matches: (parsed: URL) => boolean;
}> = [
  {
    name: "google",
    matches: (parsed) => parsed.hostname.toLowerCase() === "accounts.google.com",
  },
  {
    name: "github",
    matches: (parsed) => {
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname.toLowerCase();
      return host === "github.com" && (path.startsWith("/login/oauth") || path === "/login");
    },
  },
  {
    name: "microsoft",
    matches: (parsed) => {
      const host = parsed.hostname.toLowerCase();
      return (
        host === "login.microsoftonline.com" ||
        host === "login.live.com" ||
        host === "login.windows.net"
      );
    },
  },
  {
    name: "apple",
    matches: (parsed) => parsed.hostname.toLowerCase() === "appleid.apple.com",
  },
  {
    name: "clerk",
    matches: (parsed) => {
      const host = parsed.hostname.toLowerCase();
      return host.endsWith(".clerk.accounts.dev") || host.startsWith("clerk.");
    },
  },
  {
    name: "auth0",
    matches: (parsed) => {
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname.toLowerCase();
      return (
        (host.endsWith(".auth0.com") || host.endsWith(".us.auth0.com")) &&
        (path.startsWith("/authorize") || path.startsWith("/u/login") || path.startsWith("/login"))
      );
    },
  },
  {
    name: "supabase",
    matches: (parsed) => {
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname.toLowerCase();
      return host.endsWith(".supabase.co") && path.startsWith("/auth/v1");
    },
  },
  {
    name: "firebase",
    matches: (parsed) => {
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname.toLowerCase();
      return host.endsWith(".firebaseapp.com") && path.includes("/__/auth");
    },
  },
];

/** Strip query parameters and hash fragments to prevent leaking tokens or private parameters */
export function sanitizeAuthUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    LOOPBACK_HOSTNAMES.has(normalized) ||
    normalized.startsWith("127.") ||
    normalized.endsWith(".localhost")
  );
}

export function hasSameRegistrableOrigin(urlA: string, urlB: string): boolean {
  try {
    const a = new URL(urlA);
    const b = new URL(urlB);
    return a.origin === b.origin;
  } catch {
    return false;
  }
}

/**
 * Classifies a browser navigation attempt into a safe, structured category.
 */
export function classifyAuthNavigation(request: AuthNavigationRequest): AuthClassificationResult {
  const rawUrl = (request.url ?? "").trim();
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      kind: "blockedUnsafeScheme",
      reason: "Malformed or unparseable URL.",
      sanitizedUrl: "[invalid-url]",
      scheme: "",
    };
  }

  const scheme = parsed.protocol.toLowerCase();
  const sanitizedUrl = `${scheme}//${parsed.host}${parsed.pathname}`;

  // 1. Unsafe local or privileged schemes
  if (BLOCKED_UNSAFE_SCHEMES.has(scheme)) {
    return {
      kind: "blockedUnsafeScheme",
      reason: `Scheme ${scheme} is not permitted in embedded preview.`,
      sanitizedUrl,
      scheme,
      hostname: parsed.hostname,
    };
  }

  // 2. Only application-owned callback protocols may enter the callback path.
  if (!ALLOWED_WEB_SCHEMES.has(scheme)) {
    if (!ALLOWED_CALLBACK_SCHEMES.has(scheme)) {
      return {
        kind: "blockedUnsafeScheme",
        reason: `Scheme ${scheme} is not an application-owned callback protocol.`,
        sanitizedUrl,
        scheme,
      };
    }
    return {
      kind: "customSchemeCallback",
      reason: `Custom application URL scheme: ${scheme}`,
      sanitizedUrl,
      scheme,
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : scheme === "https:" ? 443 : 80;

  // 3. Loopback callbacks (e.g. http://127.0.0.1:port/callback)
  if (isLoopbackHostname(hostname)) {
    return {
      kind: "loopbackCallback",
      reason: "Localhost loopback callback listener.",
      sanitizedUrl,
      scheme,
      hostname,
      port,
    };
  }

  // 4. Check for providers that explicitly block embedded user agents from OAuth
  for (const provider of EXTERNAL_OAUTH_PROVIDERS) {
    if (provider.matches(parsed)) {
      return {
        kind: "externalOAuthRequired",
        provider: provider.name,
        reason: `${provider.name} OAuth 2.0 authorization endpoint prohibits embedded user agents.`,
        sanitizedUrl,
        scheme,
        hostname,
        port,
      };
    }
  }

  // 5. Match other federated identity providers
  const matchedProvider = KNOWN_AUTH_PROVIDERS.find((p) => p.matches(parsed));

  // 6. Explicit profile login window requested by user in settings
  if (request.profileLoginIntent) {
    return {
      kind: "samePartitionLoginWindow",
      provider: matchedProvider?.name,
      reason: "User-initiated profile authentication window.",
      sanitizedUrl,
      scheme,
      hostname,
      port,
    };
  }

  const isWindowOpen = request.isWindowOpen || request.disposition === "new-window";

  // 7. Scripted popups (window.open) on federated auth providers
  if (isWindowOpen && matchedProvider) {
    return {
      kind: "embeddedPopupCandidate",
      provider: matchedProvider.name,
      reason: `Federated authentication popup for ${matchedProvider.name}.`,
      sanitizedUrl,
      scheme,
      hostname,
      port,
    };
  }

  // 8. Scripted popup on OAuth authorization path
  const path = parsed.pathname.toLowerCase();
  if (isWindowOpen && (path.includes("/oauth/authorize") || path.includes("/oauth2/authorize"))) {
    return {
      kind: "embeddedPopupCandidate",
      provider: "oauth2",
      reason: "OAuth 2.0 authorization popup.",
      sanitizedUrl,
      scheme,
      hostname,
      port,
    };
  }

  // 9. If the navigation originated from the same registrable origin, it is an in-app
  // navigation (e.g. my-app.com clicking "Log in" to navigate to my-app.com/login).
  // This must NEVER be treated as an external OAuth or detached popup!
  if (request.initiatingUrl && hasSameRegistrableOrigin(request.initiatingUrl, rawUrl)) {
    return {
      kind: "ordinaryNavigation",
      reason: "Same-origin navigation within preview application.",
      sanitizedUrl,
      scheme,
      hostname,
      port,
    };
  }

  // 10. General navigation fallback
  return {
    kind: "ordinaryNavigation",
    reason: "Standard web navigation.",
    sanitizedUrl,
    scheme,
    hostname,
    port,
  };
}
