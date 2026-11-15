import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { encodeStoredReference } from "@tabs/shared/secretProviders/storedReference";
import { SecretResolver } from "../secrets/SecretResolverCore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitCafeCredentials from "./GitCafeCredentials.ts";

const layer = (token: string) =>
  GitCafeCredentials.layer.pipe(
    Layer.provide(Layer.mock(VcsProcess.VcsProcess)({})),
    Layer.provide(ServerSettings.ServerSettingsService.layerTest({ gitcafe: { token } })),
  );

it.effect("uses the token saved in settings for git.cafe before the environment", () => {
  process.env.CAFE_TOKEN = "env-token";
  return Effect.gen(function* () {
    const credentials = yield* GitCafeCredentials.GitCafeCredentials;
    const credential = yield* credentials.get("git.cafe");
    assert.strictEqual(credential.source, "settings");
    assert.strictEqual(Redacted.value(credential.token), "saved-token");
  }).pipe(Effect.provide(layer("saved-token")));
});

it.effect("falls back to CAFE_TOKEN when settings hold none", () => {
  process.env.CAFE_TOKEN = "env-token";
  delete process.env.CAFE_HOST;
  return Effect.gen(function* () {
    const credential = yield* (yield* GitCafeCredentials.GitCafeCredentials).get("git.cafe");
    assert.strictEqual(credential.source, "env");
  }).pipe(Effect.provide(layer("")));
});

it.effect("reads a token saved as a secret reference from its provider", () => {
  const resolver = Layer.succeed(
    SecretResolver,
    SecretResolver.of({
      read: (references) => Effect.succeed(references.map(() => "from-provider")),
      invalidate: () => Effect.void,
      label: (provider) => Effect.succeed(provider),
    }),
  );
  return Effect.gen(function* () {
    const credential = yield* (yield* GitCafeCredentials.GitCafeCredentials).get("git.cafe");
    assert.strictEqual(credential.source, "settings");
    assert.strictEqual(Redacted.value(credential.token), "from-provider");
  }).pipe(
    Effect.provide(
      Layer.provideMerge(
        layer(encodeStoredReference({ provider: "op" as never, reference: "op://v/i/f" })),
        resolver,
      ),
    ),
  );
});
