import type { OrchestratorMcpCapabilitiesInput, ServerProviderModel } from "@tabs/contracts";

/** A discoverable short catalog, while delegation still validates against every model. */
export function selectCapabilityModels(
  models: readonly ServerProviderModel[],
  input: OrchestratorMcpCapabilitiesInput = {},
  inheritedModel?: string | null,
) {
  const search = input.search?.toLocaleLowerCase();
  const matches = search
    ? models.filter((model) =>
        `${model.slug} ${model.name} ${(model.aliases ?? []).join(" ")}`
          .toLocaleLowerCase()
          .includes(search),
      )
    : [...models];
  if (input.includeAll)
    return { models: matches, totalModels: models.length, hasMoreModels: false };
  if (!search) {
    const rank = (model: ServerProviderModel) =>
      model.slug === inheritedModel ? 3 : model.isDefault ? 2 : model.isCustom ? 1 : 0;
    matches.sort((left, right) => rank(right) - rank(left));
  }
  const offset = input.offset ?? 0;
  const limit = input.limit ?? (search ? 40 : 8);
  const selected = matches.slice(offset, offset + limit);
  const hasMoreModels = offset + selected.length < matches.length;
  return {
    models: selected,
    totalModels: models.length,
    hasMoreModels,
    ...(hasMoreModels ? { nextOffset: offset + selected.length } : {}),
  };
}
