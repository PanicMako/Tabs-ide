import {
  computeDpopAccessTokenHash,
  computeDpopJwkThumbprint,
  DpopPublicJwk,
} from "@tabs/shared/dpop";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { importJWK, SignJWT, type JWK } from "jose";

export interface BrowserDpopKey {
  readonly privateKey: CryptoKey;
  readonly publicJwk: typeof DpopPublicJwk.Type;
  readonly thumbprint: string;
}

export class BrowserDpopError extends Data.TaggedError("BrowserDpopError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const DATABASE_NAME = "tabs:cloud-auth";
const STORE_NAME = "keys";
const KEY_ID = "relay-dpop-proof-key";
const decodePublicJwk = Schema.decodeUnknownEffect(DpopPublicJwk);

export const browserCryptoLayer = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
    digest: (algorithm, data) =>
      Effect.promise(
        async () =>
          new Uint8Array(await globalThis.crypto.subtle.digest(algorithm, new Uint8Array(data))),
      ),
  }),
);

const fail = (message: string, cause?: unknown) => new BrowserDpopError({ message, cause });

function openDatabase(): Effect.Effect<IDBDatabase, BrowserDpopError> {
  return Effect.callback((resume) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.addEventListener("error", () =>
      resume(Effect.fail(fail("Could not open DPoP key storage.", request.error))),
    );
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME))
        request.result.createObjectStore(STORE_NAME);
    });
    request.addEventListener("success", () => resume(Effect.succeed(request.result)));
  });
}

export function readStoredBrowserDpopKey(): Effect.Effect<BrowserDpopKey | null, BrowserDpopError> {
  if (typeof indexedDB === "undefined") return Effect.succeed(null);
  return Effect.acquireUseRelease(
    openDatabase(),
    (database) =>
      Effect.callback((resume) => {
        const request = database
          .transaction(STORE_NAME, "readonly")
          .objectStore(STORE_NAME)
          .get(KEY_ID);
        request.addEventListener("error", () =>
          resume(Effect.fail(fail("Could not read DPoP key.", request.error))),
        );
        request.addEventListener("success", () =>
          resume(Effect.succeed((request.result as BrowserDpopKey | undefined) ?? null)),
        );
      }),
    (database) => Effect.sync(() => database.close()),
  );
}

export function writeStoredBrowserDpopKey(
  key: BrowserDpopKey,
): Effect.Effect<void, BrowserDpopError> {
  if (typeof indexedDB === "undefined") return Effect.void;
  return Effect.acquireUseRelease(
    openDatabase(),
    (database) =>
      Effect.callback((resume) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.addEventListener("error", () =>
          resume(Effect.fail(fail("Could not write DPoP key.", transaction.error))),
        );
        transaction.addEventListener("complete", () => resume(Effect.void));
        transaction.objectStore(STORE_NAME).put(key, KEY_ID);
      }),
    (database) => Effect.sync(() => database.close()),
  );
}

export const generateBrowserDpopKey = Effect.gen(function* () {
  const pair = yield* Effect.tryPromise({
    try: () =>
      crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
        "sign",
        "verify",
      ]) as Promise<CryptoKeyPair>,
    catch: (cause) => fail("Could not generate DPoP proof key.", cause),
  });
  const privateJwk = yield* Effect.tryPromise({
    try: () => crypto.subtle.exportKey("jwk", pair.privateKey),
    catch: (cause) => fail("Could not export DPoP private key.", cause),
  });
  const publicJwk = yield* Effect.tryPromise({
    try: () => crypto.subtle.exportKey("jwk", pair.publicKey),
    catch: (cause) => fail("Could not export DPoP public key.", cause),
  }).pipe(
    Effect.flatMap(decodePublicJwk),
    Effect.mapError((cause) => fail("Generated DPoP public key is invalid.", cause)),
  );
  const privateKey = yield* Effect.tryPromise({
    try: () => importJWK(privateJwk as JWK, "ES256", { extractable: false }) as Promise<CryptoKey>,
    catch: (cause) => fail("Could not import DPoP private key.", cause),
  });
  return { privateKey, publicJwk, thumbprint: computeDpopJwkThumbprint(publicJwk) };
});

export function createBrowserDpopProof(input: {
  readonly method: string;
  readonly url: string;
  readonly accessToken?: string;
  readonly proofKey: BrowserDpopKey;
}) {
  return Effect.gen(function* () {
    const url = new URL(input.url);
    url.search = "";
    url.hash = "";
    const jti = yield* Crypto.Crypto.pipe(
      Effect.flatMap((service) => service.randomUUIDv4),
      Effect.mapError((cause) => fail("Could not generate DPoP proof identifier.", cause)),
    );
    const proof = yield* Effect.tryPromise({
      try: () =>
        new SignJWT({
          htm: input.method.toUpperCase(),
          htu: url.toString(),
          jti,
          ...(input.accessToken ? { ath: computeDpopAccessTokenHash(input.accessToken) } : {}),
        })
          .setProtectedHeader({ typ: "dpop+jwt", alg: "ES256", jwk: input.proofKey.publicJwk })
          .setIssuedAt()
          .sign(input.proofKey.privateKey),
      catch: (cause) => fail("Could not sign DPoP proof.", cause),
    });
    return { proof, thumbprint: input.proofKey.thumbprint };
  });
}
