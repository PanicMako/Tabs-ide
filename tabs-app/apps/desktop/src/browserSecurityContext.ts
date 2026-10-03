/**
 * Browser Security Context & Origin Transparency.
 *
 * Computes verified HTTPS security status, registrable domains, punycode/IDN
 * spoof warnings, and profile identity for embedded browser sessions.
 *
 * Strict rule: Never display a misleading secure status for broken or non-HTTPS
 * pages. Certificate errors always downgrade status to "broken".
 */

import type { DesktopBrowserSecurityContext } from "@tabs/contracts";
import { getDomain } from "tldts";
import { extractProfileIdFromPartition } from "./profileStorage";

export function deriveRegistrableDomain(hostname: string): string {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!normalized) return "";

  // IP addresses or localhost remain as-is
  if (
    normalized === "localhost" ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(normalized) ||
    normalized.includes(":")
  ) {
    return normalized;
  }

  return getDomain(normalized, { allowPrivateDomains: true }) ?? normalized;
}

export function hasPunycodeOrHomoglyphWarning(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  // Punycode prefixes (RFC 3492) indicate internationalized domain names
  // which can be used for homoglyph / visual spoofing attacks.
  if (normalized.includes("xn--")) {
    return true;
  }
  // Check for non-ASCII unicode characters in raw hostname
  // eslint-disable-next-line no-control-regex
  if (/[^\u0000-\u007F]/.test(normalized)) {
    return true;
  }
  return false;
}

export function deriveSecurityState(params: {
  readonly url: string | null | undefined;
  readonly certificateError?: string | null | undefined;
}): "secure" | "insecure" | "broken" | "unknown" {
  const rawUrl = params.url?.trim();
  if (!rawUrl || rawUrl === "about:blank") {
    return "unknown";
  }

  // Certificate or TLS errors immediately result in broken security status
  if (params.certificateError) {
    return "broken";
  }

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "https:") {
      return "secure";
    }
    if (parsed.protocol === "http:") {
      const host = parsed.hostname.toLowerCase();
      // Localhost is treated as a secure development context per W3C Secure Contexts specification
      if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
        return "secure";
      }
      return "insecure";
    }
    return "unknown";
  } catch {
    return "broken";
  }
}

export function buildSecurityContext(params: {
  readonly url: string | null | undefined;
  readonly partition?: string | null | undefined;
  readonly certificateError?: string | null | undefined;
  readonly isTabsOwned?: boolean | undefined;
}): DesktopBrowserSecurityContext {
  const rawUrl = params.url?.trim() ?? null;
  const securityState = deriveSecurityState({
    url: rawUrl,
    certificateError: params.certificateError,
  });

  let registrableDomain: string | null = null;
  let origin: string | null = null;
  let hasPunycodeWarning = false;

  if (rawUrl && rawUrl !== "about:blank") {
    try {
      const parsed = new URL(rawUrl);
      origin = parsed.origin;
      registrableDomain = deriveRegistrableDomain(parsed.hostname);
      hasPunycodeWarning = hasPunycodeOrHomoglyphWarning(parsed.hostname);
    } catch {
      registrableDomain = null;
      origin = null;
    }
  }

  const profileId = extractProfileIdFromPartition(params.partition);

  return {
    securityState,
    registrableDomain,
    origin,
    profileId,
    isTabsOwned: params.isTabsOwned ?? true,
    certificateError: params.certificateError ?? null,
    hasPunycodeWarning,
  };
}
