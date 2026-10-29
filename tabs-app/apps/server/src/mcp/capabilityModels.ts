import type { OrchestratorMcpCapabilitiesInput, ServerProviderModel } from "@tabs/contracts";

const MAX_CAPABILITY_MODELS_PER_PAGE = 100;
const DEFAULT_CAPABILITY_MODELS_PER_PAGE = 8;
const DEFAULT_SEARCH_MODELS_PER_PAGE = 40;

/** Select a complete legacy catalog or an explicitly requested bounded page. */
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

  const hasExplicitQuery =
    input.search !== undefined ||
    input.limit !== undefined ||
    input.offset !== undefined ||
    input.includeAll !== undefined;
  if (!hasExplicitQuery || input.includeAll === true) {
    return { models: matches, totalModels: models.length, hasMoreModels: false };
  }

  if (!search) {
    const rank = (model: ServerProviderModel) =>
      model.slug === inheritedModel ? 3 : model.isDefault ? 2 : model.isCustom ? 1 : 0;
    matches.sort((left, right) => rank(right) - rank(left));
  }

  const requestedLimit =
    input.limit ?? (search ? DEFAULT_SEARCH_MODELS_PER_PAGE : DEFAULT_CAPABILITY_MODELS_PER_PAGE);
  const limit = Math.min(Math.max(requestedLimit, 1), MAX_CAPABILITY_MODELS_PER_PAGE);
  const offset = Math.max(input.offset ?? 0, 0);
  const selected = matches.slice(offset, offset + limit);
  const hasMoreModels = offset + selected.length < matches.length;
  return {
    models: selected,
    totalModels: models.length,
    hasMoreModels,
    ...(hasMoreModels ? { nextOffset: offset + selected.length } : {}),
  };
}
