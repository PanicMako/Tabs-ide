import type {
  DesktopExchangeListing,
  DesktopInstalledExtension,
  DesktopPreparedExchangeInstall,
} from "@tabs/contracts";

/** Applies only permission-neutral signed updates at an inactive-view boundary. */
export class ExchangeAutomaticUpdater {
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly listInstalled: () => readonly DesktopInstalledExtension[],
    private readonly availableFor: (
      entry: DesktopInstalledExtension,
    ) => DesktopExchangeListing | null,
    private readonly canApply: (extensionId: string) => boolean,
    private readonly prepare: (
      listing: DesktopExchangeListing,
      options: { readonly automatic: true },
    ) => Promise<DesktopPreparedExchangeInstall>,
    private readonly confirm: (
      token: string,
      options: { readonly silent: true },
    ) => Promise<unknown>,
    private readonly cancel: (token: string) => void,
    private readonly onChanged: () => void,
    private readonly onError: (id: string, error: unknown) => void,
  ) {}

  applyAvailable(): Promise<void> {
    this.inFlight ??= this.applyNow().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async applyNow(): Promise<void> {
    const installed = this.listInstalled().filter(
      (entry) => entry.source === "exchange" && !entry.revoked && !entry.updatesPinned,
    );
    for (const entry of installed) {
      const listing = this.availableFor(entry);
      if (!listing || !this.canApply(entry.id)) continue;
      try {
        const prepared = await this.prepare(listing, { automatic: true });
        let confirmed = false;
        try {
          const current = this.listInstalled().find((candidate) => candidate.id === entry.id);
          if (
            prepared.willKeepEnabled &&
            prepared.digest === listing.digest &&
            prepared.registryOrigin === entry.registryOrigin &&
            current?.digest === entry.digest &&
            current?.manifest.version === entry.manifest.version &&
            this.canApply(entry.id)
          ) {
            await this.confirm(prepared.token, { silent: true });
            confirmed = true;
            this.onChanged();
          }
        } finally {
          if (!confirmed) this.cancel(prepared.token);
        }
      } catch (error) {
        this.onError(entry.id, error);
      }
    }
  }
}
