import type { ProviderInstanceId } from "@tabs/contracts";
import type { UnifiedSettings } from "@tabs/contracts/settings";

export interface PinnedModelEntry {
  readonly provider: ProviderInstanceId | string;
  readonly model: string;
}

/**
 * Reads all pinned models from settings with backwards compatibility fallback
 * to legacy settings.favorites if pinnedModels is empty.
 */
export function getPinnedModels(
  input: Partial<UnifiedSettings> | ReadonlyArray<PinnedModelEntry> | null | undefined,
): ReadonlyArray<PinnedModelEntry> {
  if (!input) return [];
  if (Array.isArray(input)) return input as ReadonlyArray<PinnedModelEntry>;
  const pinned = (input as Record<string, unknown>).pinnedModels;
  if (Array.isArray(pinned)) {
    return pinned as ReadonlyArray<PinnedModelEntry>;
  }
  // Fallback to legacy favorites if pinnedModels is not set at all
  const legacyFavorites = (input as Record<string, unknown>).favorites;
  if (Array.isArray(legacyFavorites)) {
    return legacyFavorites as ReadonlyArray<PinnedModelEntry>;
  }
  return [];
}

/**
 * Checks if a specific model is pinned for a given provider instance ID or driver.
 */
export function isPinnedModel(
  pinnedModels: ReadonlyArray<PinnedModelEntry> | null | undefined,
  instanceId: string,
  modelSlug: string,
): boolean {
  if (!pinnedModels || pinnedModels.length === 0) return false;
  const targetInstance = instanceId.trim();
  const targetModel = modelSlug.trim();
  return pinnedModels.some(
    (entry) =>
      (entry.provider === targetInstance ||
        (entry.provider === "" && targetInstance === "codex")) &&
      entry.model === targetModel,
  );
}

/**
 * Toggles a model's pinned status immutably while preventing duplicate entries.
 */
export function togglePinnedModel(
  input: Partial<UnifiedSettings> | ReadonlyArray<PinnedModelEntry> | null | undefined,
  instanceId: string,
  modelSlug: string,
): Array<PinnedModelEntry> {
  const current = getPinnedModels(input);
  const targetInstance = instanceId.trim();
  const targetModel = modelSlug.trim();

  const isAlreadyPinned = isPinnedModel(current, targetInstance, targetModel);

  if (isAlreadyPinned) {
    return current.filter(
      (entry) =>
        !(
          (entry.provider === targetInstance || entry.provider === "") &&
          entry.model === targetModel
        ),
    );
  }

  // Filter out any partial match and append new pinned entry
  const cleaned = current.filter(
    (entry) => !(entry.provider === targetInstance && entry.model === targetModel),
  );
  return [...cleaned, { provider: targetInstance as ProviderInstanceId, model: targetModel }];
}

/**
 * Reorders pinned models by moving an item from fromIndex to toIndex.
 */
export function reorderPinnedModels(
  input: Partial<UnifiedSettings> | ReadonlyArray<PinnedModelEntry> | null | undefined,
  fromIndex: number,
  toIndex: number,
): Array<PinnedModelEntry> {
  const current = [...getPinnedModels(input)];
  if (
    fromIndex < 0 ||
    fromIndex >= current.length ||
    toIndex < 0 ||
    toIndex >= current.length ||
    fromIndex === toIndex
  ) {
    return current;
  }
  const [moved] = current.splice(fromIndex, 1);
  if (moved) {
    current.splice(toIndex, 0, moved);
  }
  return current;
}

/**
 * Sorts an array of models so that pinned models appear first.
 */
export function sortModelsWithPinnedFirst<T extends { slug: string }>(
  models: ReadonlyArray<T>,
  pinnedInput: Partial<UnifiedSettings> | ReadonlyArray<PinnedModelEntry> | null | undefined,
  instanceId: string,
): T[] {
  const pinnedList = getPinnedModels(pinnedInput);
  return [...models].sort((a, b) => {
    const isAPinned = isPinnedModel(pinnedList, instanceId, a.slug);
    const isBPinned = isPinnedModel(pinnedList, instanceId, b.slug);
    if (isAPinned && !isBPinned) return -1;
    if (!isAPinned && isBPinned) return 1;
    return 0;
  });
}
