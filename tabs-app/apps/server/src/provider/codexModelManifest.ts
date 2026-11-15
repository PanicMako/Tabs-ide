import type { ProviderDriverKind, ServerProviderUpdateRequiredModel } from "@tabs/contracts";
import { codexModelFamily } from "@tabs/shared/model";
import { compareSemverVersions, parseSemver } from "@tabs/shared/semver";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "@tabs/contracts";

import * as ModelManifest from "./ModelManifest.ts";
import type { ServerProviderDraft } from "./providerSnapshot.ts";

const CodexModelAdapter = Schema.Struct({
  codex: Schema.optional(Schema.Struct({ minVersion: Schema.optional(TrimmedNonEmptyString) })),
});
const decodeCodexModelAdapter = Schema.decodeUnknownOption(CodexModelAdapter);

/** Codex catalogs omit models released after the installed CLI. */
export function codexUpdateRequiredModels(
  manifest: ModelManifest.ModelManifestData,
  driverKind: ProviderDriverKind,
  draft: ServerProviderDraft,
): ReadonlyArray<ServerProviderUpdateRequiredModel> {
  const catalog = ModelManifest.resolveProviderCatalog(manifest, driverKind);
  const version = draft.version?.replace(/^v/, "");
  if (!catalog || !version || parseSemver(version) === null) return [];
  const discovered = new Set(draft.models.map((model) => codexModelFamily(model.slug)));
  return catalog.models.flatMap(({ model, adapter }) => {
    if (model.isLegacy || discovered.has(codexModelFamily(model.slug))) return [];
    const minVersion = Option.getOrUndefined(decodeCodexModelAdapter(adapter ?? {}))?.codex
      ?.minVersion;
    if (!minVersion || parseSemver(minVersion) === null) return [];
    if (compareSemverVersions(version, minVersion) >= 0) return [];
    return [
      {
        slug: model.slug,
        name: model.name,
        ...(model.badge ? { badge: model.badge } : {}),
        minVersion,
      },
    ];
  });
}

/** `applyModelManifest`, plus the models the installed Codex CLI is too old to list. */
export function applyCodexModelManifest(
  draft: ServerProviderDraft,
  manifest: ModelManifest.ModelManifestData,
  driverKind: ProviderDriverKind,
): ServerProviderDraft {
  const { updateRequiredModels: _previous, ...rest } = draft;
  const updateRequiredModels = codexUpdateRequiredModels(manifest, driverKind, rest);
  return {
    ...ModelManifest.applyModelManifest(rest, manifest, driverKind),
    ...(updateRequiredModels.length > 0 ? { updateRequiredModels } : {}),
  };
}
