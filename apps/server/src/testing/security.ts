import { createHash } from "node:crypto";

export interface AccessibilitySecurityResult {
  readonly sanitized: string;
  readonly flags: ReadonlyArray<string>;
}

export interface PiiToken {
  readonly token: string;
  readonly kind: string;
  readonly plaintext: string;
  readonly digest: string;
}

export interface TokenizationResult {
  readonly tokenized: string;
  readonly tokens: ReadonlyArray<PiiToken>;
}

const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?previous\s+instructions?/i,
  /(?:system|developer)\s+(?:message|prompt|instruction)/i,
  /reveal|exfiltrate|send|upload/i,
  /(?:secret|credential|api[ _-]?key|password|token)/i,
  /you\s+are\s+(?:chatgpt|an?\s+ai|an?\s+assistant)/i,
] as const;

const ZERO_SIZE_PATTERN = /\[(?:box=[^\]]*,(?:0(?:\.0+)?),(?:0(?:\.0+)?)|size=0x0)\]/i;
const HIDDEN_PATTERN = /\[(?:hidden|aria-hidden=true|visible=false)\]/i;

function indentationDepth(line: string): number {
  const leadingSpaces = line.length - line.trimStart().length;
  return Math.floor(leadingSpaces / 2);
}

function looksInjected(line: string): boolean {
  let matches = 0;
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(line)) matches += 1;
  }
  return matches >= 2;
}

export function sanitizeAccessibilitySnapshot(
  snapshot: string,
  options: { readonly maxDepth?: number } = {},
): AccessibilitySecurityResult {
  const maxDepth = options.maxDepth ?? 12;
  const flags: string[] = [];
  const keptLines: string[] = [];

  for (const line of snapshot.split("\n")) {
    if (indentationDepth(line) > maxDepth) {
      flags.push("max-depth-exceeded");
      continue;
    }
    if (ZERO_SIZE_PATTERN.test(line) || HIDDEN_PATTERN.test(line)) {
      flags.push("hidden-or-zero-size-element");
      continue;
    }
    if (looksInjected(line)) {
      flags.push(`possible-prompt-injection:${shortDigest(line)}`);
      continue;
    }
    keptLines.push(line.replace(/\s+$/u, ""));
  }

  return {
    sanitized: keptLines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    flags: [...new Set(flags)],
  };
}

const PII_PATTERNS = [
  {
    kind: "EMAIL",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    kind: "HOST_IDENTITY",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\b/gi,
  },
  {
    kind: "CARD",
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
  },
  {
    kind: "PHONE",
    pattern: /(?<!\w)(?:\+?\d{1,3}[ .-]?)?(?:\(?\d{2,4}\)?[ .-]?)\d{3,4}[ .-]?\d{4}(?!\w)/g,
  },
] as const;

const CREDENTIAL_TEXT_PATTERN =
  /\b(?:bearer\s+[A-Za-z0-9._~+/-]{20,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]{16,}|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+)\b/gi;
const CREDENTIAL_PARAMETER_PATTERN =
  /^(?:authorization|auth|code|credential|jwt|key|password|secret|session|signature|token)$/i;
const SECRET_PREFIX_PATTERN = /^(?:sk|pk|api|key|secret|session|token)[_-][A-Za-z0-9_-]{12,}$/i;
const JWT_PATTERN = /^eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
const LONG_ENCODED_PATTERN = /^(?:[A-Fa-f0-9]{24,}|[A-Za-z0-9_-]{32,}={0,2})$/;

function safeDecodeUrlSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function shouldRedactPathSegment(value: string): boolean {
  const decoded = safeDecodeUrlSegment(value);
  return (
    JWT_PATTERN.test(decoded) ||
    SECRET_PREFIX_PATTERN.test(decoded) ||
    LONG_ENCODED_PATTERN.test(decoded) ||
    /(?:password|secret|token|credential|authorization)[=:]/i.test(decoded)
  );
}

function sanitizePathname(pathname: string): string {
  const sanitized = pathname
    .split("/")
    .filter((segment, index) => index === 0 || segment.length > 0)
    .map((segment) => (shouldRedactPathSegment(segment) ? "<REDACTED_PATH_SEGMENT>" : segment));
  const joined = sanitized.join("/") || "/";
  return joined.startsWith("/") ? joined : `/${joined}`;
}

function sanitizeHashRoute(hash: string): string {
  if (!hash.startsWith("#/")) return "";
  const route = new URL(hash.slice(1), "https://tabs-testing.invalid");
  return `#${sanitizePathname(route.pathname)}`;
}

export function sanitizePersistedUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.username = "";
  url.password = "";
  url.pathname = sanitizePathname(url.pathname);
  const parameterNames = [...new Set(url.searchParams.keys())].toSorted();
  url.search = "";
  for (const name of parameterNames) {
    url.searchParams.append(
      CREDENTIAL_PARAMETER_PATTERN.test(name) ? "<SENSITIVE_PARAM>" : name,
      "<QUERY_VALUE>",
    );
  }
  url.hash = sanitizeHashRoute(url.hash);
  return url.href;
}

export function redactCredentialLikeText(value: string): string {
  return value
    .replace(CREDENTIAL_TEXT_PATTERN, "<REDACTED_CREDENTIAL>")
    .replace(/\b[A-Fa-f0-9]{40,}\b/g, "<REDACTED_HIGH_ENTROPY>")
    .replace(/\b[A-Za-z0-9_-]{48,}={0,2}\b/g, "<REDACTED_HIGH_ENTROPY>");
}

export function sanitizeModelBoundText(projectId: string, value: string): TokenizationResult {
  const bounded = value
    .split("\n")
    .filter((line) => !looksInjected(line))
    .join("\n")
    .split(String.fromCharCode(0))
    .join("")
    .slice(0, 120_000);
  return tokenizePii(projectId, redactCredentialLikeText(bounded));
}

export function tokenizePii(projectId: string, text: string): TokenizationResult {
  const discovered = new Map<string, PiiToken>();
  let tokenized = redactCredentialLikeText(text);

  for (const { kind, pattern } of PII_PATTERNS) {
    tokenized = tokenized.replace(pattern, (plaintext) => {
      const normalized = plaintext.toLowerCase().replace(/[ -]/g, "");
      const digest = createHash("sha256")
        .update(`${projectId}\0${kind}\0${normalized}`)
        .digest("hex");
      const token = `<PII_${kind}_${digest.slice(0, 12)}>`;
      discovered.set(token, { token, kind, plaintext, digest });
      return token;
    });
  }

  return { tokenized, tokens: [...discovered.values()] };
}

export function normalizeStructuralSnapshot(snapshot: string): string {
  return snapshot
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "<VOLATILE_ID>")
    .replace(
      /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g,
      "<VOLATILE_TIME>",
    )
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/gi, "<VOLATILE_TIME>")
    .replace(
      /\b(?:session|request|trace|nonce)[-_ ]?(?:id)?[:= ]+[A-Za-z0-9_-]{6,}\b/gi,
      "<VOLATILE_ID>",
    )
    .replace(/\b(?:slide|item|page)\s+\d+\s+(?:of|\/)\s+\d+\b/gi, "<VOLATILE_CAROUSEL>")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAccessibilityForStorage(snapshot: string): string {
  return snapshot
    .replace(/\s+\[ref=[^\]]+\]/g, "")
    .replace(/\s+\[box=[^\]]+\]/g, "")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

export function shortDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function structuralHash(snapshot: string): string {
  return createHash("sha256").update(normalizeStructuralSnapshot(snapshot)).digest("hex");
}

export function splitStaticSubtrees(snapshot: string): ReadonlyArray<string> {
  const lines = snapshot.split("\n").filter((line) => line.trim().length > 0);
  const subtrees: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (indentationDepth(line) === 0 && current.length > 0) {
      subtrees.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) subtrees.push(current.join("\n"));
  return subtrees;
}
