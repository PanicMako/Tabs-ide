import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ServerProviderUsageSnapshot } from "@tabs/contracts";

import { __resetProviderUsageCacheForTests, listProviderUsageSnapshots } from "./index";
import type { ProviderUsageContext, ProviderUsageFetcher } from "./types";

const fetchMock = vi.fn<(ctx: ProviderUsageContext) => Promise<ServerProviderUsageSnapshot>>();
const cacheKeyMock = vi.fn<(ctx: ProviderUsageContext) => Promise<string>>();

vi.mock("./registry", () => ({
  PROVIDER_USAGE_FETCHERS: {
    codex: {
      provider: "codex",
      cacheKey: (ctx: ProviderUsageContext) => cacheKeyMock(ctx),
      fetch: (ctx: ProviderUsageContext) => fetchMock(ctx),
    } satisfies ProviderUsageFetcher,
  },
}));

const NOW_MS = 1_780_000_000_000;

function okSnapshot(nowMs: number, source = "live"): ServerProviderUsageSnapshot {
  return {
    provider: "codex",
    updatedAt: new Date(nowMs).toISOString(),
    limits: [],
    usageLines: [],
    source,
    status: "ok",
  };
}

beforeEach(() => {
  __resetProviderUsageCacheForTests();
  fetchMock.mockReset();
  cacheKeyMock.mockReset();
  cacheKeyMock.mockImplementation(async (ctx) => ctx.env.TEST_USAGE_ACCOUNT ?? "account-a");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listProviderUsageSnapshots caching", () => {
  it("serves a fresh snapshot from cache without re-fetching", async () => {
    fetchMock.mockResolvedValue(okSnapshot(NOW_MS));

    const first = await listProviderUsageSnapshots({ provider: "codex" });
    const second = await listProviderUsageSnapshots({ provider: "codex" });

    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent requests into a single fetch", async () => {
    let release: (snapshot: ServerProviderUsageSnapshot) => void = () => {};
    fetchMock.mockImplementation(
      () => new Promise<ServerProviderUsageSnapshot>((resolve) => (release = resolve)),
    );

    const firstPromise = listProviderUsageSnapshots({ provider: "codex" });
    const secondPromise = listProviderUsageSnapshots({ provider: "codex" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    release(okSnapshot(NOW_MS));
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("bypasses the TTL on forceRefresh", async () => {
    fetchMock.mockImplementation(async (ctx) => okSnapshot(ctx.nowMs));

    await listProviderUsageSnapshots({ provider: "codex" });
    const refreshed = await listProviderUsageSnapshots({
      provider: "codex",
      forceRefresh: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshed).toHaveLength(1);
  });
});
