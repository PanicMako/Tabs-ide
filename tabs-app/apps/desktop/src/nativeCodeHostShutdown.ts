export interface NativeCodeHostShutdownEvent {
  readonly reason: number;
  join(id: string, promise: Promise<void>): void;
}

export function createNativeCodeHostShutdown(
  fire: (event: NativeCodeHostShutdownEvent) => void,
  cleanup: () => void,
): () => Promise<void> {
  let shutdown: Promise<void> | undefined;
  return () => {
    // Defer delivery so reentrant requests also share this promise.
    shutdown ??= Promise.resolve().then(async () => {
      const joins: Promise<void>[] = [];
      let deliveryError: unknown;
      try {
        fire({
          reason: 1,
          join: (_id, promise) => {
            joins.push(promise);
          },
        });
      } catch (error) {
        deliveryError = error;
      }
      const results = await Promise.allSettled(joins);
      cleanup();
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (deliveryError !== undefined) errors.push(deliveryError);
      if (errors.length) throw new AggregateError(errors, "Code-OSS shutdown joins failed");
    });
    return shutdown;
  };
}
