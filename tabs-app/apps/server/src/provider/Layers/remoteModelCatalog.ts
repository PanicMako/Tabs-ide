import { Effect, Schema } from "effect";
import {
  type ServerProviderModel,
  validateServerProviderModelList,
  inferModelCapabilitiesFromSlug,
} from "@tabs/contracts";

export const RemoteModelCatalogSchema = Schema.Struct({
  version: Schema.Number,
  updatedAt: Schema.String,
  providers: Schema.Record(Schema.String, Schema.Array(Schema.Unknown)),
});

export interface RemoteCatalogResult {
  readonly modelsByProvider: Readonly<Record<string, ReadonlyArray<ServerProviderModel>>>;
}

export const REMOTE_CATALOG_URL =
  process.env.TABS_REMOTE_MODEL_CATALOG_URL ||
  "https://raw.githubusercontent.com/PanicMako/Tabs-ide/main/models-catalog.json";

/**
 * Fetches dynamic remote model catalog registry.
 * Validates payload via Effect/Schema. Fails closed (returns empty map on network error or offline state).
 */
export function fetchRemoteModelCatalog(): Effect.Effect<RemoteCatalogResult> {
  return Effect.tryPromise(async () => {
    const response = await fetch(REMOTE_CATALOG_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000), // 3s timeout guard
    });
    if (!response.ok) {
      return { modelsByProvider: {} };
    }
    const raw = await response.json();
    const decode = Schema.decodeUnknownOption(RemoteModelCatalogSchema);
    const decodedOption = decode(raw);
    if (decodedOption._tag === "None") {
      console.warn(
        "[RemoteModelCatalog] Invalid schema received from remote catalog registry, failing closed.",
      );
      return { modelsByProvider: {} };
    }

    const decoded = decodedOption.value;
    const modelsByProvider: Record<string, ServerProviderModel[]> = {};

    for (const [providerKey, rawList] of Object.entries(decoded.providers)) {
      if (Array.isArray(rawList)) {
        const modelsWithCaps = rawList.map((item: any) => {
          const slug = typeof item?.slug === "string" ? item.slug.trim() : "";
          const name = typeof item?.name === "string" && item.name ? item.name : slug;
          return {
            slug,
            name,
            isCustom: false,
            source: "remote-fallback" as const,
            capabilities:
              item?.capabilities || inferModelCapabilitiesFromSlug(slug, "remote-fallback"),
          };
        });
        modelsByProvider[providerKey] = validateServerProviderModelList(modelsWithCaps);
      }
    }

    return { modelsByProvider };
  }).pipe(Effect.orElseSucceed(() => ({ modelsByProvider: {} as const })));
}
