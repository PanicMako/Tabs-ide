// Purpose: Bounded JSON helper for provider usage

export interface FetchJsonResult {
  readonly status: number;
  readonly ok: boolean;
  readonly json: unknown;
  readonly headers: Headers;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export async function fetchJson(input: {
  service: string;
  url: string;
  allowedOrigins?: ReadonlyArray<string>;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  /** How to encode `body`: JSON (default) or application/x-www-form-urlencoded (OAuth endpoints). */
  bodyFormat?: "json" | "form";
  timeoutMs?: number;
}): Promise<FetchJsonResult> {
  const headers: Record<string, string> = {};
  if (input.body !== undefined) {
    if (input.bodyFormat === "form") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else {
      headers["Content-Type"] = "application/json";
    }
  }
  if (input.headers) {
    for (const [key, value] of Object.entries(input.headers)) {
      headers[key] = value;
    }
  }

  const encodedBody =
    input.body === undefined
      ? undefined
      : input.bodyFormat === "form"
        ? new URLSearchParams(input.body as Record<string, string>).toString()
        : JSON.stringify(input.body);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(input.url, {
      method: input.method ?? "GET",
      headers,
      body: encodedBody,
      signal: controller.signal,
    });

    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }

    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      json,
      headers: response.headers,
    };
  } catch {
    return {
      status: 0,
      ok: false,
      json: null,
      headers: new Headers(),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Provider backends reject the access token once it is stale; treat that as "needs re-auth". */
export function isAuthFailureStatus(status: number): boolean {
  return status === 401 || status === 403;
}

/** The backend is throttling requests; callers should back off rather than blank the usage panel. */
export function isRateLimitStatus(status: number): boolean {
  return status === 429;
}

/**
 * Parse an HTTP `Retry-After` header into a positive delay in ms.
 */
export function parseRetryAfterMs(headers: Headers, nowMs: number): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    return seconds > 0 ? seconds * 1000 : undefined;
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - nowMs;
    return delta > 0 ? delta : undefined;
  }
  return undefined;
}
