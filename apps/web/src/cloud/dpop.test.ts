import { decodeJwt, decodeProtectedHeader } from "jose";
import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";

import { browserCryptoLayer, createBrowserDpopProof, generateBrowserDpopKey } from "./dpop";

describe("browser DPoP", () => {
  it("creates a proof bound to the normalized request and access token", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const proofKey = yield* generateBrowserDpopKey;
        return yield* createBrowserDpopProof({
          method: "post",
          url: "https://relay.example.test/api/connect?ignored=true#fragment",
          accessToken: "access-token",
          proofKey,
        });
      }).pipe(Effect.provide(browserCryptoLayer)),
    );

    expect(result.thumbprint).toBeTruthy();
    expect(decodeProtectedHeader(result.proof)).toMatchObject({
      alg: "ES256",
      typ: "dpop+jwt",
    });
    expect(decodeJwt(result.proof)).toMatchObject({
      htm: "POST",
      htu: "https://relay.example.test/api/connect",
    });
    expect(decodeJwt(result.proof).ath).toBeTruthy();
  });
});
