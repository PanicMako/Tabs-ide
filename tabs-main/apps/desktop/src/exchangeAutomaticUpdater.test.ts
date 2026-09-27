import type {
  DesktopExchangeListing,
  DesktopInstalledExtension,
  DesktopPreparedExchangeInstall,
} from "@tabs/contracts";
import { describe, expect, it, vi } from "vitest";
import { ExchangeAutomaticUpdater } from "./exchangeAutomaticUpdater";

const origin = "https://exchange.tabs.example";
const entry = {
  id: "acme.dashboard",
  source: "exchange",
  registryOrigin: origin,
  digest: "a".repeat(64),
  manifest: { publisher: "acme", name: "dashboard", version: "1.0.0" },
} as DesktopInstalledExtension;
const listing = {
  id: entry.id,
  registryOrigin: origin,
  namespace: "acme",
  name: "dashboard",
  version: "1.0.1",
  digest: "b".repeat(64),
} as DesktopExchangeListing;
const prepared = {
  token: "token",
  digest: listing.digest,
  registryOrigin: origin,
  willKeepEnabled: true,
} as DesktopPreparedExchangeInstall;

describe("Exchange automatic updates", () => {
  it("coalesces calls and applies a neutral update only at a safe boundary", async () => {
    let installed = [entry];
    let safe = false;
    const prepare = vi.fn(async () => prepared);
    const confirm = vi.fn(async () => undefined);
    const cancel = vi.fn();
    const changed = vi.fn();
    const updater = new ExchangeAutomaticUpdater(
      () => installed,
      () => listing,
      () => safe,
      prepare,
      confirm,
      cancel,
      changed,
      vi.fn(),
    );
    await updater.applyAvailable();
    expect(prepare).not.toHaveBeenCalled();
    safe = true;
    const first = updater.applyAvailable();
    const second = updater.applyAvailable();
    await Promise.all([first, second]);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(listing, { automatic: true });
    expect(confirm).toHaveBeenCalledWith("token", { silent: true });
    expect(cancel).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
    installed = [{ ...entry, updatesPinned: true }];
    await updater.applyAvailable();
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("cancels permission increases and a changed installation", async () => {
    let installed = [entry];
    let candidate = { ...prepared, willKeepEnabled: false };
    const confirm = vi.fn(async () => undefined);
    const cancel = vi.fn();
    const updater = new ExchangeAutomaticUpdater(
      () => installed,
      () => listing,
      () => true,
      async () => {
        if (candidate.willKeepEnabled) installed = [{ ...entry, digest: "c".repeat(64) }];
        return candidate;
      },
      confirm,
      cancel,
      vi.fn(),
      vi.fn(),
    );
    await updater.applyAvailable();
    expect(confirm).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith("token");
    candidate = { ...prepared };
    await updater.applyAvailable();
    expect(confirm).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("reports install errors and cancels unused review tokens", async () => {
    const error = vi.fn();
    const cancel = vi.fn();
    const updater = new ExchangeAutomaticUpdater(
      () => [entry],
      () => listing,
      () => true,
      async () => prepared,
      async () => {
        throw new Error("stale signature");
      },
      cancel,
      vi.fn(),
      error,
    );
    await updater.applyAvailable();
    expect(cancel).toHaveBeenCalledWith("token");
    expect(error).toHaveBeenCalledWith(entry.id, expect.any(Error));
  });
});
