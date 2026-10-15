const endpoint = "https://exchange.buildwithtabs.com/livez";

export async function probe(fetcher = fetch) {
  const started = Date.now();
  const response = await fetcher(endpoint, {
    method: "GET",
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(90_000),
    headers: { "User-Agent": "Tabs-Exchange-Monitor/1.0" },
  });
  await response.body?.cancel();
  if (response.status !== 200)
    throw new Error(`Exchange liveness returned HTTP ${response.status}`);
  return { status: response.status, durationMs: Date.now() - started };
}
