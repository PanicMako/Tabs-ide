export interface ProviderModelPreference {
  readonly hiddenModels: ReadonlyArray<string>;
  readonly modelOrder: ReadonlyArray<string>;
}

export type ProviderModelPreferencesMap = Readonly<
  Record<
    string,
    {
      readonly hiddenModels: ReadonlyArray<string>;
      readonly modelOrder: ReadonlyArray<string>;
    }
  >
>;

export function getModelScore(name: string): number {
  const lower = name.toLowerCase();
  let familyScore = 0;

  if (lower.includes("fable")) familyScore = 10000;
  else if (lower.includes("opus")) familyScore = 8000;
  else if (lower.includes("sonnet")) familyScore = 6000;
  else if (lower.includes("haiku")) familyScore = 4000;
  else if (lower.includes("sol")) familyScore = 10000;
  else if (lower.includes("terra")) familyScore = 8000;
  else if (lower.includes("luna")) familyScore = 6000;

  const match = name.match(/\d+(\.\d+)?/);
  const version = match ? parseFloat(match[0]) : 0;
  const miniPenalty = lower.includes("mini") ? -100 : 0;

  return familyScore + version * 10 + miniPenalty;
}

export function sortModelsByDefaultSequence<T extends { slug: string; name?: string }>(
  models: ReadonlyArray<T>,
): T[] {
  if (!models || models.length <= 1) return [...models];

  const autoModel = models.find(
    (m) => m.slug === "auto" || (m.name && m.name.toLowerCase() === "auto"),
  );
  const restModels = models.filter((m) => m !== autoModel);

  const sortedRest = [...restModels].sort((a, b) => {
    const scoreA = getModelScore(a.name ?? a.slug);
    const scoreB = getModelScore(b.name ?? b.slug);
    return scoreB - scoreA;
  });

  return autoModel ? [autoModel, ...sortedRest] : sortedRest;
}

/**
 * Sorts models according to custom user modelOrder while ensuring "auto" models remain at index 0.
 */
export function applyCustomModelOrdering<T extends { slug: string; name?: string }>(
  models: ReadonlyArray<T>,
  modelOrder: ReadonlyArray<string> | null | undefined,
  _provider?: string,
): T[] {
  if (!models || models.length <= 1) return [...models];

  if (!modelOrder || modelOrder.length === 0) {
    return sortModelsByDefaultSequence(models);
  }

  // Partition "auto" model if present
  const autoModel = models.find(
    (m) => m.slug === "auto" || (m.name && m.name.toLowerCase() === "auto"),
  );
  const restModels = models.filter((m) => m !== autoModel);

  const orderMap = new Map<string, number>();
  modelOrder.forEach((slug, idx) => {
    orderMap.set(slug, idx);
  });

  const defaultSortedRest = sortModelsByDefaultSequence(restModels);

  const sortedRest = [...defaultSortedRest].sort((a, b) => {
    const idxA = orderMap.get(a.slug);
    const idxB = orderMap.get(b.slug);

    if (idxA !== undefined && idxB !== undefined) {
      return idxA - idxB;
    }
    if (idxA !== undefined && idxB === undefined) {
      return -1;
    }
    if (idxA === undefined && idxB !== undefined) {
      return 1;
    }
    return 0;
  });

  return autoModel ? [autoModel, ...sortedRest] : sortedRest;
}

/**
 * Immutably updates the custom model order for a provider instance.
 */
export function updateModelOrder<T extends ProviderModelPreferencesMap>(
  preferences: T | null | undefined,
  instanceId: string,
  newOrder: string[],
): T {
  const currentMap = (preferences ?? {}) as Record<string, any>;
  const currentPref = currentMap[instanceId] ?? { hiddenModels: [], modelOrder: [] };
  const cleanedOrder = [...new Set(newOrder.filter((s) => s.trim().length > 0))];

  if (
    cleanedOrder.length === 0 &&
    (!currentPref.hiddenModels || currentPref.hiddenModels.length === 0)
  ) {
    const { [instanceId]: _, ...rest } = currentMap;
    return rest as T;
  }

  return {
    ...currentMap,
    [instanceId]: {
      ...currentPref,
      modelOrder: cleanedOrder,
    },
  } as T;
}

/**
 * Resets custom model order for a provider instance.
 */
export function resetModelOrder<T extends ProviderModelPreferencesMap>(
  preferences: T | null | undefined,
  instanceId: string,
): T {
  if (!preferences || !preferences[instanceId]) {
    return (preferences ?? {}) as T;
  }
  const { [instanceId]: target, ...rest } = preferences as Record<string, any>;

  if (target && target.hiddenModels && target.hiddenModels.length > 0) {
    return {
      ...rest,
      [instanceId]: {
        hiddenModels: target.hiddenModels,
        modelOrder: [],
      },
    } as T;
  }
  return rest as T;
}

export interface BulkToggleOptions {
  readonly preserveSlugs?: ReadonlySet<string> | ReadonlyArray<string>;
}

/**
 * Checks whether all selectable built-in models in the provided list are currently hidden.
 */
export function isAllBuiltInModelsHidden<
  T extends { readonly slug: string; readonly isCustom?: boolean },
>(
  models: ReadonlyArray<T>,
  hiddenModels: ReadonlyArray<string> | null | undefined,
  options?: BulkToggleOptions,
): boolean {
  const currentHidden = new Set(hiddenModels ?? []);
  const preserveSet = new Set(options?.preserveSlugs ?? []);
  const builtInSlugs = models
    .filter((model) => !model.isCustom && !preserveSet.has(model.slug))
    .map((model) => model.slug);

  return builtInSlugs.length > 0 && builtInSlugs.every((slug) => currentHidden.has(slug));
}

/**
 * Computes the next hiddenModels array when bulk toggling (enable all / disable all).
 * - Preserves custom models (never hides them).
 * - Preserves required or default models specified in `options.preserveSlugs`.
 * - If all eligible target built-in models are hidden, unhides them.
 * - Otherwise, hides all eligible target built-in models.
 */
export function nextHiddenModelsForBulkToggle<
  T extends { readonly slug: string; readonly isCustom?: boolean },
>(
  targetModels: ReadonlyArray<T>,
  hiddenModels: ReadonlyArray<string> | null | undefined,
  options?: BulkToggleOptions,
): string[] {
  const currentHidden = hiddenModels ?? [];
  const currentHiddenSet = new Set(currentHidden);
  const preserveSet = new Set(options?.preserveSlugs ?? []);

  const builtInSlugs = targetModels
    .filter((model) => !model.isCustom && !preserveSet.has(model.slug))
    .map((model) => model.slug);
  const builtInSlugSet = new Set(builtInSlugs);

  if (builtInSlugs.length === 0) {
    return [...currentHidden];
  }

  const allTargetHidden = builtInSlugs.every((slug) => currentHiddenSet.has(slug));

  if (allTargetHidden) {
    return currentHidden.filter((slug) => !builtInSlugSet.has(slug));
  }

  return [...new Set([...currentHidden, ...builtInSlugs])];
}

/**
 * Immutably updates hidden models for a provider instance, pruning redundant empty settings.
 */
export function updateHiddenModels<T extends ProviderModelPreferencesMap>(
  preferences: T | null | undefined,
  instanceId: string,
  newHidden: string[],
): T {
  const currentMap = (preferences ?? {}) as Record<string, any>;
  const currentPref = currentMap[instanceId] ?? { hiddenModels: [], modelOrder: [] };
  const cleanedHidden = [...new Set(newHidden.filter((s) => s.trim().length > 0))];

  if (
    cleanedHidden.length === 0 &&
    (!currentPref.modelOrder || currentPref.modelOrder.length === 0)
  ) {
    const { [instanceId]: _, ...rest } = currentMap;
    return rest as T;
  }

  return {
    ...currentMap,
    [instanceId]: {
      ...currentPref,
      hiddenModels: cleanedHidden,
    },
  } as T;
}

/**
 * Toggles a single model slug's hidden state for a provider instance.
 */
export function toggleHiddenModel<T extends ProviderModelPreferencesMap>(
  preferences: T | null | undefined,
  instanceId: string,
  slug: string,
  forceHidden?: boolean,
): T {
  const currentMap = (preferences ?? {}) as Record<string, any>;
  const currentPref = currentMap[instanceId] ?? { hiddenModels: [], modelOrder: [] };
  const currentHidden = new Set<string>(currentPref.hiddenModels ?? []);

  const shouldHide = forceHidden !== undefined ? forceHidden : !currentHidden.has(slug);
  if (shouldHide) {
    currentHidden.add(slug);
  } else {
    currentHidden.delete(slug);
  }

  return updateHiddenModels(preferences, instanceId, Array.from(currentHidden));
}
