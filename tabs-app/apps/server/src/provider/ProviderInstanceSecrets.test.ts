import { assert, describe, it } from "@effect/vitest";
import {
  AntigravitySettings,
  DroidSettings,
  OpenRouterSettings,
  SecretProviderId,
  SettingsSecretValue,
  secretReferencesInSettings,
  type ProviderInstanceEnvironment,
} from "@tabs/contracts";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SecretResolver from "../secrets/SecretResolver.ts";
import {
  resolveInstanceConfigSecrets,
  resolveInstanceEnvironment,
  unreadableSecretReason,
} from "./ProviderInstanceSecrets.ts";

const work = SecretProviderId.make("work");
const reference = (path: string) => ({ provider: work, reference: path });
const variable = (name: string, value: ProviderInstanceEnvironment[number]["value"]) =>
  ({ name, value, sensitive: typeof value !== "string" }) as ProviderInstanceEnvironment[number];

const resolverLayer = (answers: Record<string, string | undefined>) =>
  Layer.succeed(SecretResolver.SecretResolver, {
    read: (references: ReadonlyArray<{ readonly reference: string }>) =>
      Effect.succeed(references.map((entry) => answers[entry.reference])),
    invalidate: () => Effect.void,
    label: () => Effect.succeed("Work vault"),
  } as never);

describe("resolveInstanceEnvironment", () => {
  it.effect("passes plain variables through and reads each reference in order", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveInstanceEnvironment([
        variable("PLAIN", "x"),
        variable("KEY_A", reference("op://v/a/key")),
        variable("KEY_B", reference("op://v/b/key")),
      ]);
      assert.deepEqual(
        resolved.environment.map(({ name, value }) => [name, value]),
        [
          ["PLAIN", "x"],
          ["KEY_A", "secret-a"],
          ["KEY_B", "secret-b"],
        ],
      );
      assert.isTrue(resolved.environment[1]?.sensitive);
      assert.deepEqual(resolved.unreadable, []);
    }).pipe(
      Effect.provide(resolverLayer({ "op://v/a/key": "secret-a", "op://v/b/key": "secret-b" })),
    ),
  );

  it.effect("leaves an unreadable or empty secret out and names it", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveInstanceEnvironment([
        variable("KEY_A", reference("op://v/a/key")),
        variable("KEY_B", reference("op://v/b/key")),
      ]);
      assert.deepEqual(resolved.environment, []);
      assert.deepEqual(resolved.unreadable, ["KEY_A", "KEY_B"]);
      assert.equal(resolved.unreadableProviderLabel, "Work vault");
      assert.include(unreadableSecretReason(resolved), "KEY_A, KEY_B");
    }).pipe(Effect.provide(resolverLayer({ "op://v/b/key": "  " }))),
  );

  it.effect("reports references as unreadable when no resolver is provided", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveInstanceEnvironment([
        variable("KEY", reference("op://v/a/key")),
      ]);
      assert.deepEqual(resolved.unreadable, ["KEY"]);
    }),
  );

  it.effect("needs no resolver for plain variables", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveInstanceEnvironment([variable("A", "1")]);
      assert.deepEqual(
        resolved.environment.map((entry) => entry.value),
        ["1"],
      );
      assert.deepEqual(resolved.unreadable, []);
    }),
  );
});

describe("resolveInstanceConfigSecrets", () => {
  const schema = Schema.Struct({
    enabled: Schema.Boolean,
    apiKey: SettingsSecretValue,
  });
  const config = (apiKey: unknown) => ({ enabled: true, apiKey }) as never;

  it.effect("puts the secret in the field that named it", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveInstanceConfigSecrets(
        schema,
        config(reference("op://v/i/key")),
      );
      assert.deepEqual(resolved.config, { enabled: true, apiKey: "sk-live" });
      assert.deepEqual(resolved.unreadable, []);
    }).pipe(Effect.provide(resolverLayer({ "op://v/i/key": "sk-live" }))),
  );

  it.effect("leaves a literal key alone and needs no resolver for it", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveInstanceConfigSecrets(schema, config("sk-inline"));
      assert.deepEqual(resolved.config, { enabled: true, apiKey: "sk-inline" });
    }),
  );

  it.effect("reports an unreadable key and leaves the field empty", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveInstanceConfigSecrets(
        schema,
        config(reference("op://v/i/key")),
      );
      assert.deepEqual(resolved.unreadable, ["apiKey"]);
      assert.equal((resolved.config as { apiKey: string }).apiKey, "");
    }).pipe(Effect.provide(resolverLayer({}))),
  );
});

describe("driver settings that accept a secret reference", () => {
  it("are found on the real provider schemas", () => {
    const ref = reference("op://v/i/key");
    for (const schema of [OpenRouterSettings, DroidSettings, AntigravitySettings]) {
      const slots = secretReferencesInSettings(schema as never, { apiKey: ref });
      assert.deepEqual(
        slots.map((slot) => slot.field),
        ["apiKey"],
      );
    }
  });
});
