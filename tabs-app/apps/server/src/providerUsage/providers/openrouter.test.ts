import { afterEach, describe, expect, it, vi } from "vitest";

import { openRouterUsageFetcher, parseOpenRouterCredits } from "./openrouter.ts";

const NOW_MS = 1_780_000_000_000;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OpenRouter usage", () => {
  it("turns purchased and used credits into a remaining balance", () => {
    const snapshot = parseOpenRouterCredits(
      { data: { total_credits: 100.5, total_usage: 25.75 } },
      NOW_MS,
    );

    expect(snapshot.status).toBe("ok");
    expect(snapshot.limits[0]?.usedPercent).toBeCloseTo(25.62, 2);
    expect(snapshot.usageLines[0]?.value).toBe("$74.75");
  });

  it("uses the configured environment key with the documented credits endpoint", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { total_credits: 10, total_usage: 4 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const snapshot = await openRouterUsageFetcher.fetch({
      homeDir: "/tmp/tester",
      env: { OPENROUTER_API_KEY: "sk-or-test" },
      platform: "linux",
      nowMs: NOW_MS,
    });

    expect(snapshot.status).toBe("ok");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/credits",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk-or-test" }),
      }),
    );
  });
});
