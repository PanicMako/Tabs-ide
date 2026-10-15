import * as Context from "effect/Context";

/** Selects the provider assembly explicitly; shared services do not imply a server generation. */
export const ProviderRuntimeGeneration = Context.Reference<"legacy" | "v2">(
  "tabs/provider/ProviderRuntimeGeneration",
  { defaultValue: () => "v2" },
);
