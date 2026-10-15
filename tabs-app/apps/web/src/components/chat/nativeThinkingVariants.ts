import type { ProviderOptionDescriptor, ServerProviderModel } from "@tabs/contracts";

export const NATIVE_THINKING_OPTION = "nativeThinkingVariant";
export type ThinkingModel = ServerProviderModel & {
  providerId?: string;
  thinkingVariants?: ReadonlyArray<{ level: string; model: ServerProviderModel }>;
};

/** Group only explicitly named variants whose native ID has the same level suffix. */
export function groupNativeThinkingVariants(
  models: ReadonlyArray<ThinkingModel>,
  selectedSlug: string,
): ThinkingModel[] {
  const families = new Map<string, ThinkingModel[]>();
  const keys = new Map<ThinkingModel, string>();
  for (const model of models) {
    const name = model.name.match(/^(.*?)\s*\((Low|Medium|High)\)$/i);
    const slug = model.slug.match(/^(.*)-(low|medium|high)$/i);
    if (!name || !slug || name[2]!.toLowerCase() !== slug[2]!.toLowerCase()) continue;
    const key = JSON.stringify([model.providerId, model.subProvider, name[1], slug[1]]);
    keys.set(model, key);
    families.set(key, [...(families.get(key) ?? []), model]);
  }
  const emitted = new Set<string>();
  return models.flatMap((model) => {
    const key = keys.get(model);
    const family = key ? families.get(key)! : [];
    if (!key || family.length < 2 || new Set(family.map((m) => m.slug)).size !== family.length) {
      return [model];
    }
    if (emitted.has(key)) return [];
    emitted.add(key);
    const representative = family.find((m) => m.slug === selectedSlug) ?? model;
    return [
      {
        ...representative,
        name: representative.name.replace(/\s*\((Low|Medium|High)\)$/i, ""),
        thinkingVariants: ["low", "medium", "high"].flatMap((level) =>
          family
            .filter((m) => m.slug.toLowerCase().endsWith(`-${level}`))
            .map((m) => ({ level, model: m })),
        ),
      },
    ];
  });
}

export function nativeThinkingDescriptor(model: ThinkingModel): ProviderOptionDescriptor[] {
  if (!model.thinkingVariants) return [];
  return [
    {
      id: NATIVE_THINKING_OPTION,
      label: "Thinking level",
      type: "select",
      currentValue: model.thinkingVariants.find((v) => v.model.slug === model.slug)?.level,
      options: model.thinkingVariants.map((v) => ({
        id: v.level,
        label: v.level[0]!.toUpperCase() + v.level.slice(1),
      })),
    },
  ];
}
