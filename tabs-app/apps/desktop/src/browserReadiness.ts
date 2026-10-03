import type { BrowserReadinessResult } from "@tabs/contracts";

export function isLiteralLoopback(url: URL): boolean {
  return (
    ["http:", "https:"].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    (url.hostname === "localhost" ||
      url.hostname === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/.test(url.hostname))
  );
}

/** Probe from the desktop network context; never send profile cookies or follow redirects. */
export async function probeBrowserReadiness(
  rawUrl: string,
  timeoutMs = 2500,
  fetcher: typeof fetch = fetch,
): Promise<BrowserReadinessResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { state: "not_local" };
  }
  if (!isLiteralLoopback(url)) return { state: "not_local" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(100, Math.min(timeoutMs, 10000)));
  const start = performance.now();
  try {
    let response = await fetcher(url.href, {
      method: "HEAD",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 405) {
      await response.body?.cancel();
      response = await fetcher(url.href, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
      });
    }
    await response.body?.cancel();
    const status = response.status;
    return {
      state:
        status === 0
          ? "unknown"
          : status < 300
            ? "ready"
            : status < 400
              ? "reachable"
              : "unhealthy",
      ...(status ? { httpStatus: status } : {}),
      latencyMs: Math.round(performance.now() - start),
      lastProbedAt: new Date().toISOString(),
    };
  } catch (error) {
    const code =
      (error as { cause?: { code?: string }; code?: string }).cause?.code ??
      (error as { code?: string }).code;
    return {
      state: controller.signal.aborted || code === "ECONNREFUSED" ? "offline" : "unknown",
      error: controller.signal.aborted
        ? "Probe timed out."
        : code === "ECONNREFUSED"
          ? "Connection refused."
          : "Could not determine server health.",
      lastProbedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}
