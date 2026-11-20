import { beforeEach, expect, it, vi } from "vitest";
import { UsageSummary } from "@tabs/contracts";
import { Schema } from "effect";
const read = vi.hoisted(() => vi.fn());
vi.mock("../nativeApi", () => ({
  ensureNativeApi: () => ({ server: { readUsageSummary: read } }),
}));
const summary = (knownModels: number) =>
  Schema.decodeUnknownSync(UsageSummary)({
    contractVersion: 6,
    readAt: "2026-10-14T12:00:00.000Z",
    sinceDay: "2026-10-01",
    untilDay: "2026-10-14",
    timeZone: "UTC",
    buckets: [],
    sources: [],
    scanDurationMs: 0,
    pricing: { status: "unavailable", source: "fixture", fetchedAt: null, knownModels },
  });
beforeEach(() => {
  vi.resetModules();
  read.mockReset();
});
it("keeps the latest selected window when a slower earlier request finishes", async () => {
  const usage = await import("./usage");
  const { appAtomRegistry } = await import("./atomRegistry");
  let finishWide!: (value: UsageSummary) => void;
  let finishNarrow!: (value: UsageSummary) => void;
  read
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishWide = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNarrow = resolve;
        }),
    );
  const wide = usage.fetchUsageSummary("all");
  const narrow = usage.fetchUsageSummary("7d");
  finishNarrow(summary(2));
  await narrow;
  finishWide(summary(1));
  await wide;
  expect(appAtomRegistry.get(usage.usageSummaryStateAtom).data?.pricing.knownModels).toBe(2);
});
it("reuses a recent window but an explicit refresh fetches fresh data", async () => {
  const usage = await import("./usage");
  read.mockResolvedValue(summary(1));
  await usage.fetchUsageSummary("7d");
  await usage.fetchUsageSummary("7d");
  expect(read).toHaveBeenCalledOnce();
  await usage.fetchUsageSummary("7d", { force: true });
  expect(read).toHaveBeenCalledTimes(2);
});
it("keeps the last window on screen while a new one scans, and returns to a seen window at once", async () => {
  const usage = await import("./usage");
  const { appAtomRegistry } = await import("./atomRegistry");
  let finishMonth!: (value: UsageSummary) => void;
  read.mockResolvedValueOnce(summary(7)).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishMonth = resolve;
      }),
  );
  await usage.fetchUsageSummary("7d");
  const month = usage.fetchUsageSummary("30d");
  expect(appAtomRegistry.get(usage.usageShownWindowAtom)).toBe("7d");
  expect(appAtomRegistry.get(usage.usageSummaryStateAtom)).toMatchObject({ loading: true });
  await usage.fetchUsageSummary("7d");
  expect(appAtomRegistry.get(usage.usageSummaryStateAtom).data?.pricing.knownModels).toBe(7);
  finishMonth(summary(30));
  await month;
  expect(appAtomRegistry.get(usage.usageShownWindowAtom)).toBe("7d");
  await usage.fetchUsageSummary("30d");
  expect(appAtomRegistry.get(usage.usageShownWindowAtom)).toBe("30d");
  expect(read).toHaveBeenCalledTimes(2);
});
