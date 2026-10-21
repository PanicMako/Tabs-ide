/** Local activation uses the installed approval; registry freshness is background work. */
export async function activateWithExchangeRefresh(options: {
  readonly source: string | undefined;
  readonly revoked: boolean | undefined;
  readonly activate: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly reportRefreshError: (error: unknown) => void;
}): Promise<void> {
  if (options.source === "exchange") {
    if (options.revoked) throw new Error("This extension version has been revoked.");
    // A fresh signed revocation still disables the installed version through the
    // existing refresh callback. Expiry/outages must not undo its local approval.
    void Promise.resolve().then(options.refresh).catch(options.reportRefreshError);
  }
  await options.activate();
}
