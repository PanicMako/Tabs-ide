import { ManagedRelay } from "@tabs/client-runtime/relay";
import { RelayWebClientId } from "@tabs/contracts/relay";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";

import {
  browserCryptoLayer,
  createBrowserDpopProof,
  generateBrowserDpopKey,
  readStoredBrowserDpopKey,
  writeStoredBrowserDpopKey,
  type BrowserDpopKey,
} from "./dpop";

export const relayDpopSignerLayer = Layer.effect(
  ManagedRelay.ManagedRelayDpopSigner,
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const lock = yield* Semaphore.make(1);
    let loaded: BrowserDpopKey | null = null;
    const load = lock.withPermit(
      Effect.gen(function* () {
        if (loaded) return loaded;
        const stored = yield* readStoredBrowserDpopKey();
        if (stored) return (loaded = stored);
        const generated = yield* generateBrowserDpopKey;
        yield* writeStoredBrowserDpopKey(generated);
        return (loaded = generated);
      }),
    );
    return ManagedRelay.ManagedRelayDpopSigner.of({
      thumbprint: load.pipe(
        Effect.map((key) => key.thumbprint),
        Effect.mapError(
          (cause) =>
            new ManagedRelay.ManagedRelayDpopKeyLoadError({ keyStore: "indexed-db", cause }),
        ),
      ),
      createProof: (input) =>
        load.pipe(
          Effect.flatMap((proofKey) =>
            createBrowserDpopProof({ ...input, proofKey }).pipe(
              Effect.provideService(Crypto.Crypto, crypto),
            ),
          ),
          Effect.map((result) => result.proof),
          Effect.mapError(
            (cause) =>
              new ManagedRelay.ManagedRelayDpopProofCreationError({
                method: input.method,
                url: input.url,
                cause,
              }),
          ),
        ),
    });
  }),
).pipe(Layer.provide(browserCryptoLayer));

export const managedRelayClientLayer = (relayUrl: string) =>
  ManagedRelay.layer({ relayUrl, clientId: RelayWebClientId }).pipe(
    Layer.provideMerge(relayDpopSignerLayer),
  );
