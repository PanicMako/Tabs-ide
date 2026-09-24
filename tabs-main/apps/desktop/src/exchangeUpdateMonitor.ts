import type { DesktopExchangeListing, DesktopInstalledExtension } from "@tabs/contracts";

interface CachedUpdate {
  readonly installedDigest: string;
  readonly installedVersion: string;
  readonly listing: DesktopExchangeListing;
}

/** Update hints are transient and never authorize installation. */
export class ExchangeUpdateMonitor {
  private readonly updates = new Map<string, CachedUpdate>();
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly listInstalled: () => readonly DesktopInstalledExtension[],
    private readonly findUpdate: (
      extension: DesktopInstalledExtension,
    ) => Promise<DesktopExchangeListing | null>,
    private readonly onChanged: () => void,
    private readonly onError: (id: string, error: unknown) => void,
  ) {}

  availableFor(extension: DesktopInstalledExtension): DesktopExchangeListing | null {
    const cached = this.updates.get(extension.id);
    return cached &&
      extension.source === "exchange" &&
      !extension.revoked &&
      cached.installedDigest === extension.digest &&
      cached.installedVersion === extension.manifest.version &&
      cached.listing.registryOrigin === extension.registryOrigin
      ? cached.listing
      : null;
  }

  check(): Promise<void> {
    this.inFlight ??= this.checkNow().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async checkNow(): Promise<void> {
    const installed = this.listInstalled().filter(
      (entry) => entry.source === "exchange" && !entry.revoked && entry.digest,
    );
    const next = new Map<string, CachedUpdate>();
    for (let start = 0; start < installed.length; start += 3) {
      await Promise.all(
        installed.slice(start, start + 3).map(async (entry) => {
          try {
            const listing = await this.findUpdate(entry);
            if (
              listing &&
              listing.id === entry.id &&
              listing.registryOrigin === entry.registryOrigin
            ) {
              next.set(entry.id, {
                installedDigest: entry.digest!,
                installedVersion: entry.manifest.version,
                listing,
              });
            }
          } catch (error) {
            this.onError(entry.id, error);
          }
        }),
      );
    }
    const current = this.listInstalled();
    for (const [id, update] of next) {
      if (
        !current.some(
          (entry) =>
            entry.id === id &&
            entry.digest === update.installedDigest &&
            entry.manifest.version === update.installedVersion &&
            !entry.revoked,
        )
      ) {
        next.delete(id);
      }
    }
    const changed =
      this.updates.size !== next.size ||
      [...next].some(
        ([id, update]) =>
          this.updates.get(id)?.installedDigest !== update.installedDigest ||
          this.updates.get(id)?.installedVersion !== update.installedVersion ||
          this.updates.get(id)?.listing.digest !== update.listing.digest,
      );
    this.updates.clear();
    for (const [id, update] of next) this.updates.set(id, update);
    if (changed) this.onChanged();
  }
}
