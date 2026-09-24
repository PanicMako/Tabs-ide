import type { DesktopExchangeListing, DesktopInstalledExtension } from "@tabs/contracts";
import { describe, expect, it, vi } from "vitest";
import { ExchangeUpdateMonitor } from "./exchangeUpdateMonitor";

const origin = "https://exchange.tabs.example";
const listing: DesktopExchangeListing = {
  registryOrigin: origin,
  id: "acme.dashboard",
  namespace: "acme",
  name: "dashboard",
  version: "1.0.1",
  digest: "b".repeat(64),
  displayName: "Dashboard",
  description: "A tool",
  verifiedPublisher: false,
  tabsCompatibility: ">=1.3.0 <2.0.0",
  capabilities: [],
};
const installed = {
  id: listing.id,
  source: "exchange",
  registryOrigin: origin,
  digest: "a".repeat(64),
  manifest: { version: "1.0.0" },
} as DesktopInstalledExtension;

describe("Exchange background update monitor", () => {
  it("coalesces checks and publishes only a candidate for the current installation", async () => {
    let entries: DesktopInstalledExtension[] = [installed];
    let finish!: (value: DesktopExchangeListing | null) => void;
    const finder = vi.fn(
      () =>
        new Promise<DesktopExchangeListing | null>((resolve) => {
          finish = resolve;
        }),
    );
    const changed = vi.fn();
    const monitor = new ExchangeUpdateMonitor(() => entries, finder, changed, vi.fn());
    const first = monitor.check();
    const second = monitor.check();
    expect(finder).toHaveBeenCalledTimes(1);
    entries = [{ ...installed, digest: "c".repeat(64) }];
    finish(listing);
    await Promise.all([first, second]);
    expect(monitor.availableFor(entries[0]!)).toBeNull();
    expect(changed).not.toHaveBeenCalled();
    finder.mockImplementation(async () => listing);
    await monitor.check();
    expect(monitor.availableFor(entries[0]!)).toEqual(listing);
    expect(changed).toHaveBeenCalledTimes(1);
    await monitor.check();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(monitor.availableFor({ ...entries[0]!, revoked: true })).toBeNull();
    entries = [];
    await monitor.check();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("drops prior hints after a failed refresh", async () => {
    let fail = false;
    const error = vi.fn();
    const monitor = new ExchangeUpdateMonitor(
      () => [installed],
      async () => {
        if (fail) throw new Error("metadata expired");
        return listing;
      },
      vi.fn(),
      error,
    );
    await monitor.check();
    expect(monitor.availableFor(installed)).toEqual(listing);
    fail = true;
    await monitor.check();
    expect(monitor.availableFor(installed)).toBeNull();
    expect(error).toHaveBeenCalledWith(installed.id, expect.any(Error));
  });
});
