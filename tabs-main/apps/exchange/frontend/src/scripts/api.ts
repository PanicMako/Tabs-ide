import { exchangeErrorGuidance } from "@tabs/shared/exchangeErrors";

export class RegistryRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function csrfToken(): string {
  return (
    document.cookie
      .split("; ")
      .find((entry) => entry.startsWith("tabs_exchange_csrf="))
      ?.slice("tabs_exchange_csrf=".length) ?? ""
  );
}

export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
  format: "json" | "text" = "json",
): Promise<T> {
  if (!/^\/v1\/[A-Za-z0-9/_.%-]+(?:\?[^#]*)?$/.test(path)) throw new Error("Invalid API route.");
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
    headers:
      method === "GET" ? {} : { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return undefined as T;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The registry response is missing. Retry the request.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 1024 * 1024) throw new Error("The registry response exceeded its limit.");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let data: unknown;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (response.ok && format === "text") return decoded as T;
    data = JSON.parse(decoded);
  } catch {
    if (response.ok) {
      throw new RegistryRequestError(
        response.status,
        "INVALID_RESPONSE",
        "The registry did not return the expected API response. Check that this site is served with its registry API, or contact its operator before retrying. No automatic retry was made.",
      );
    }
    // Proxies may return HTML or invalid bytes. Keep HTTP access guidance without
    // exposing that response or parser diagnostics to publishers and reviewers.
    const guidance = exchangeErrorGuidance(response.status, undefined);
    throw new RegistryRequestError(response.status, guidance.code, guidance.message);
  }
  if (!response.ok) {
    const guidance = exchangeErrorGuidance(response.status, data);
    throw new RegistryRequestError(response.status, guidance.code, guidance.message);
  }
  return data as T;
}

export interface Actor {
  login: string;
  publishingEnabled: boolean;
  termsVersion: string;
  admin: boolean;
  operator?: boolean;
}
export interface Namespace {
  name: string;
  role: "owner" | "contributor";
  verified: boolean;
}
