import { expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import * as Effect from "effect/Effect";
import { signRelayJwt, verifyRelayJwt } from "./relayJwt.ts";
it("verifies real signed token and rejects mismatched type, audience, issuer and age", async () => {
  const keys = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
  const token = await Effect.runPromise(
    signRelayJwt({
      privateKey: keys.privateKey,
      typ: "audit+jwt",
      payload: { iss: "issuer", aud: "aud", iat: 100, exp: 200, sub: "subject" },
    }),
  );
  const base = {
    publicKey: keys.publicKey,
    token,
    typ: "audit+jwt",
    issuer: "issuer",
    audience: "aud",
    nowEpochSeconds: 101,
  };
  expect((await Effect.runPromise(verifyRelayJwt(base))).sub).toBe("subject");
  for (const patch of [
    { typ: "other+jwt" },
    { audience: "other" },
    { issuer: "other" },
    { nowEpochSeconds: 1000 },
  ]) {
    expect((await Effect.runPromiseExit(verifyRelayJwt({ ...base, ...patch })))._tag).toBe(
      "Failure",
    );
  }
});
