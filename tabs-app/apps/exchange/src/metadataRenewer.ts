/** Coalesce readers and avoid repeated database checks while a publication is fresh. */
export function createMetadataRenewer(
  renew: () => Promise<unknown>,
  now = Date.now,
): () => Promise<void> {
  let running: Promise<void> | undefined;
  let nextCheck = 0;
  return () => {
    if (running) return running;
    if (now() < nextCheck) return Promise.resolve();
    running = Promise.resolve()
      .then(renew)
      .then(() => {
        nextCheck = now() + 30_000;
      })
      .finally(() => {
        running = undefined;
      });
    return running;
  };
}
