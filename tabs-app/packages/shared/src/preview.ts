/**
 * Pure URL helpers shared between the preview server, desktop main process,
 * and web renderer. Centralising these guarantees the four call sites agree
 * on what counts as "loopback" and how to normalise a free-form URL string.
 */

import * as Schema from "effect/Schema";

export const BROWSER_SELECTION_DRAG_MIME = "application/vnd.tabs.browser-selection";
export const BROWSER_SELECTION_MAX_LENGTH = 1_000;

/** Desktop tabs opened by a person carry their account and require an explicit page grant. */
export function isUserBrowserTab(id: string) {
  return id === "browser" || id.startsWith("custom-") || id.startsWith("agents-surface-");
}

const PROTECTED_BROWSER_URL_KEY =
  /token|secret|password|passcode|credential|signature|samlresponse|api[-_ ]?key|access[-_ ]?key|^(?:_*auth|_*session(?:[-_]?id)?|code|state|relaystate|sig|key|jwt|nonce|otp|sso|ticket|assertion|samlrequest)(?:\[.*\])?$/iu;

/** Refuse to save query or fragment state that may contain access credentials. */
export function hasProtectedBrowserUrlState(url: URL): boolean {
  let state: string;
  try {
    state = decodeURIComponent((url.search + url.hash).replaceAll("+", " "));
  } catch {
    return true;
  }
  return (
    /%[a-f0-9]{2}/iu.test(state) ||
    /(?:^|[=#/])(?:[a-z\d_.~-]{24,})(?:[&#;/?]|$)/iu.test(state) ||
    state.split(/[?&#;]/u).some((part) => {
      const equals = part.indexOf("=");
      return equals > 0 && PROTECTED_BROWSER_URL_KEY.test(part.slice(0, equals).trim());
    })
  );
}

const TAB_ID_PREFIX = "tab_";
let nextPreviewTabSequence = 0;

/**
 * Generate a fresh preview tab id. Lives in shared (not contracts) because
 * the contracts package is schema-only — runtime helpers belong here.
 */
export function newPreviewTabId(): string {
  nextPreviewTabSequence += 1;
  return `${TAB_ID_PREFIX}${nextPreviewTabSequence.toString(36)}`;
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

/** Internal — used by `lsof` parsing where the host string is wire-formatted. */
export const LSOF_LOCAL_HOST_TOKENS: ReadonlySet<string> = new Set([
  ...LOOPBACK_HOSTS,
  "*",
  "[::]",
  "[::1]",
]);

const LOOPBACK_PREFIX_PATTERN = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::|\/|$)/i;

export function isLoopbackHost(host: string): boolean {
  if (LOOPBACK_HOSTS.has(host)) return true;
  if (host === "[::1]") return true;
  return false;
}

/** True when a raw URL string looks like a loopback dev URL we can preview. */
export function isPreviewableUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

export class PreviewUrlNormalizationError extends Schema.TaggedError<PreviewUrlNormalizationError>()(
  "PreviewUrlNormalizationError",
  {
    inputLength: Schema.Number,
    reason: Schema.Literals(["empty", "parse", "unsupported-protocol"]),
    protocol: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    const protocol = this.protocol === undefined ? "" : `: ${this.protocol}`;
    return `Invalid preview URL (${this.reason}${protocol}; input length ${this.inputLength}).`;
  }
}

export const isPreviewUrlNormalizationError = Schema.is(PreviewUrlNormalizationError);

function previewUrlProtocol(rawUrl: string): string | undefined {
  return /^([A-Za-z][A-Za-z\d+.-]*):/.exec(rawUrl)?.[1]?.toLowerCase().concat(":");
}

/**
 * Normalise a free-form URL string into a fully-qualified `http(s)://` URL.
 *
 * - Bare loopback hosts (`localhost`, `localhost:5173`) become `http://...`.
 * - Bare public hosts (`example.com`) become `https://...`.
 * - Already-qualified URLs are validated and returned as `URL.href`.
 *
 * Throws `PreviewUrlNormalizationError` for empty, unparseable, or
 * unsupported-protocol inputs.
 */
export function normalizePreviewUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    throw new PreviewUrlNormalizationError({ inputLength: rawUrl.length, reason: "empty" });
  }
  const useHttp = LOOPBACK_PREFIX_PATTERN.test(trimmed);
  const candidate = trimmed.includes("://")
    ? trimmed
    : `${useHttp ? "http" : "https"}://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch (cause) {
    throw new PreviewUrlNormalizationError({
      inputLength: rawUrl.length,
      reason: "parse",
      protocol: previewUrlProtocol(candidate),
      cause,
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PreviewUrlNormalizationError({
      inputLength: rawUrl.length,
      reason: "unsupported-protocol",
      protocol: parsed.protocol,
    });
  }
  return parsed.href;
}
