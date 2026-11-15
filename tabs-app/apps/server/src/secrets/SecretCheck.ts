import type { SecretReference, SecretSourceCheckResult } from "@tabs/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProviderInstanceRegistryMutator from "../provider/ProviderInstanceRegistryMutator.ts";
import * as SecretResolver from "./SecretResolver.ts";

export class SecretCheck extends Context.Service<
  SecretCheck,
  {
    /**
     * Reads one secret fresh for the Settings "check" button and never returns the value. A
     * readable secret also rebuilds the provider instances that read it.
     */
    readonly check: (reference: SecretReference) => Effect.Effect<SecretSourceCheckResult>;
  }
>()("tabs/secrets/SecretCheck") {}

const make = Effect.gen(function* () {
  const resolver = yield* SecretResolver.SecretResolver;
  const mutator = yield* Effect.serviceOption(
    ProviderInstanceRegistryMutator.ProviderInstanceRegistryMutator,
  );

  const check = Effect.fn("SecretCheck.check")(function* (reference: SecretReference) {
    const [value] = yield* resolver.read([reference], { fresh: true });
    if (value === undefined || value.trim() === "") {
      return {
        _tag: "Failed",
        detail: `Could not read this secret from "${yield* resolver.label(reference.provider)}". Check the provider's settings and that its store is unlocked.`,
      } as const;
    }
    if (mutator._tag === "Some") yield* mutator.value.refreshSecret(reference);
    return { _tag: "Resolved" } as const;
  });

  return SecretCheck.of({ check });
});

export const layer = Layer.effect(SecretCheck, make);
