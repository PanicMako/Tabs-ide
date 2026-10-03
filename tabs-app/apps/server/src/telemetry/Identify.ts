import { Effect, FileSystem } from "effect";
import * as Crypto from "node:crypto";
import { ServerConfig } from "../config";

/** Called only after explicit opt-in. Never reads provider account/authentication files. */
export const getTelemetryIdentifier = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const { anonymousIdPath } = yield* ServerConfig;
  const existing = yield* fileSystem
    .readFileString(anonymousIdPath)
    .pipe(Effect.orElseSucceed(() => ""));
  // Rotate legacy/non-UUID identifiers rather than retaining provider-derived identity.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) {
    return existing;
  }
  const identifier = Crypto.randomUUID();
  yield* fileSystem.writeFileString(anonymousIdPath, identifier);
  return identifier;
}).pipe(Effect.orElseSucceed(() => null));

/** Opt-out removes the installation identifier; a later opt-in starts a new identity. */
export const clearTelemetryIdentifier = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const { anonymousIdPath } = yield* ServerConfig;
  if (yield* fileSystem.exists(anonymousIdPath)) {
    yield* fileSystem.remove(anonymousIdPath);
  }
});
