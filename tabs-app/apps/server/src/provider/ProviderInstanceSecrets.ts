import {
  isSecretReference,
  secretReferencesInSettings,
  withSettingsSecrets,
  type ProviderInstanceEnvironment,
  type ResolvedProviderInstanceEnvironment,
  type SecretReference,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";

import * as SecretResolver from "../secrets/SecretResolver.ts";

/** Every secret reference an instance's environment holds, in variable order. */
export const secretReferencesIn = (
  environment: ProviderInstanceEnvironment | undefined,
): ReadonlyArray<SecretReference> =>
  (environment ?? []).flatMap((variable) =>
    isSecretReference(variable.value) ? [variable.value] : [],
  );

export const sameSecretReference = (a: SecretReference, b: SecretReference) =>
  a.provider === b.provider && a.reference === b.reference;

export interface ResolvedInstanceEnvironment {
  readonly environment: ResolvedProviderInstanceEnvironment;
  /** Names of variables whose secret could not be read. */
  readonly unreadable: ReadonlyArray<string>;
  /** The provider the first unreadable secret lives in, as the user named it. */
  readonly unreadableProviderLabel: string | undefined;
}

/**
 * Reads the secrets an instance's environment points at. An unreadable or empty secret leaves its
 * variable out and is reported, so a driver never falls back to an inherited credential.
 */
export const resolveInstanceEnvironment = Effect.fn("ProviderInstanceSecrets.resolveEnvironment")(
  function* (variables: ProviderInstanceEnvironment | undefined) {
    const entries = variables ?? [];
    const references = secretReferencesIn(entries);
    if (references.length === 0) {
      return {
        environment: entries.flatMap((variable) =>
          typeof variable.value === "string" ? [{ ...variable, value: variable.value }] : [],
        ),
        unreadable: [],
        unreadableProviderLabel: undefined,
      } satisfies ResolvedInstanceEnvironment;
    }
    const resolver = yield* Effect.serviceOption(SecretResolver.SecretResolver);
    const values =
      resolver._tag === "Some"
        ? yield* resolver.value.read(references)
        : references.map(() => undefined);
    let index = 0;
    const unreadable: Array<string> = [];
    let unreadableReference: SecretReference | undefined;
    const environment: ResolvedProviderInstanceEnvironment = entries.flatMap((variable) => {
      if (typeof variable.value === "string") return [{ ...variable, value: variable.value }];
      const reference = variable.value;
      const secret = values[index++];
      if (secret === undefined || secret.trim() === "") {
        unreadable.push(variable.name);
        unreadableReference ??= reference;
        return [];
      }
      return [{ ...variable, value: secret, sensitive: true }];
    });
    const unreadableProviderLabel =
      unreadableReference === undefined
        ? undefined
        : resolver._tag === "Some"
          ? yield* resolver.value.label(unreadableReference.provider)
          : unreadableReference.provider;
    return {
      environment,
      unreadable,
      unreadableProviderLabel,
    } satisfies ResolvedInstanceEnvironment;
  },
);

export const unreadableSecretReason = (resolved: {
  readonly unreadable: ReadonlyArray<string>;
  readonly unreadableProviderLabel: string | undefined;
}) =>
  `Could not read ${resolved.unreadable.join(", ")} from the secret provider "${resolved.unreadableProviderLabel ?? "unknown"}". Unlock or fix it in Settings, then refresh.`;

export interface ResolvedInstanceConfig<Config> {
  readonly config: Config;
  /** Names of settings fields whose secret could not be read. */
  readonly unreadable: ReadonlyArray<string>;
  readonly unreadableProviderLabel: string | undefined;
}

/**
 * Reads the secrets a driver's own settings point at, such as an API key, and puts each value in
 * its field. An unreadable or empty secret is reported and its field left unset, so a driver never
 * falls back to another credential.
 */
export const resolveInstanceConfigSecrets = Effect.fn("ProviderInstanceSecrets.resolveConfig")(
  function* <Config>(schema: Schema.Top, config: Config) {
    const slots = secretReferencesInSettings(schema, config);
    if (slots.length === 0) {
      return {
        config,
        unreadable: [],
        unreadableProviderLabel: undefined,
      } satisfies ResolvedInstanceConfig<Config>;
    }
    const resolver = yield* Effect.serviceOption(SecretResolver.SecretResolver);
    const values =
      resolver._tag === "Some"
        ? yield* resolver.value.read(slots.map(({ reference }) => reference))
        : slots.map(() => undefined);
    const unreadable: Array<string> = [];
    let firstUnreadable: SecretReference | undefined;
    const readable = slots.flatMap((slot, index) => {
      const value = values[index];
      if (value === undefined || value.trim() === "") {
        unreadable.push(slot.key === undefined ? slot.field : `${slot.field}.${slot.key}`);
        firstUnreadable ??= slot.reference;
        return [{ field: slot.field, key: slot.key, value: "" }];
      }
      return [{ field: slot.field, key: slot.key, value }];
    });
    const unreadableProviderLabel =
      firstUnreadable === undefined
        ? undefined
        : resolver._tag === "Some"
          ? yield* resolver.value.label(firstUnreadable.provider)
          : firstUnreadable.provider;
    return {
      config: withSettingsSecrets(config as Readonly<Record<string, unknown>>, readable) as Config,
      unreadable,
      unreadableProviderLabel,
    } satisfies ResolvedInstanceConfig<Config>;
  },
);
