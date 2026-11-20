/**
 * Per-provider favorites for the model picker. Separate from pinned models
 * (which span providers): when a provider has "Favorites first" turned on, its
 * tab in the picker lists the favorites (and the selected model) and folds the
 * rest behind "Show more". The switch is off by default, and while it is off
 * nothing about the picker changes.
 */
import {
  withProviderPreference,
  type ProviderModelPreference,
  type ProviderModelPreferencesMap,
} from "./modelOrdering";

function preferenceFor(
  preferences: ProviderModelPreferencesMap | null | undefined,
  instanceId: string,
): ProviderModelPreference {
  const current = preferences?.[instanceId];
  return {
    ...current,
    hiddenModels: current?.hiddenModels ?? [],
    modelOrder: current?.modelOrder ?? [],
  };
}

export function isFavoritesFirst(
  preferences: ProviderModelPreferencesMap | null | undefined,
  instanceId: string,
): boolean {
  return preferences?.[instanceId]?.favoritesFirst === true;
}

export function getFavoriteModels(
  preferences: ProviderModelPreferencesMap | null | undefined,
  instanceId: string,
): ReadonlyArray<string> {
  return preferences?.[instanceId]?.favoriteModels ?? [];
}

export function setFavoritesFirst<T extends ProviderModelPreferencesMap>(
  preferences: T | null | undefined,
  instanceId: string,
  enabled: boolean,
): T {
  const current = preferenceFor(preferences, instanceId);
  // Turning the switch off keeps the starred models, so turning it back on
  // restores the same list.
  const { favoritesFirst: _, ...rest } = current;
  return withProviderPreference(
    preferences,
    instanceId,
    enabled ? { ...rest, favoritesFirst: true } : rest,
  );
}

export function toggleFavoriteModel<T extends ProviderModelPreferencesMap>(
  preferences: T | null | undefined,
  instanceId: string,
  slug: string,
): T {
  const target = slug.trim();
  if (!target) return (preferences ?? {}) as T;
  const current = preferenceFor(preferences, instanceId);
  const favorites = current.favoriteModels ?? [];
  const next = favorites.includes(target)
    ? favorites.filter((entry) => entry !== target)
    : [...favorites, target];
  const { favoriteModels: _, ...rest } = current;
  return withProviderPreference(
    preferences,
    instanceId,
    next.length > 0 ? { ...rest, favoriteModels: next } : rest,
  );
}

interface FavoriteCandidate {
  readonly slug: string;
  /** Picker rows group a model's thinking levels; any of them can be the favorite. */
  readonly thinkingVariants?: ReadonlyArray<{ readonly model: { readonly slug: string } }>;
}

export function isFavoriteModel(
  model: FavoriteCandidate,
  favorites: ReadonlyArray<string> | ReadonlySet<string>,
): boolean {
  const set = favorites instanceof Set ? favorites : new Set(favorites);
  return (
    set.has(model.slug) || (model.thinkingVariants?.some((v) => set.has(v.model.slug)) ?? false)
  );
}

/**
 * The provider tab's list with favorites first. Collapsed, it shows favorites
 * plus anything `keep` insists on (the selected model); expanded, it shows every
 * model with favorites still on top. Each group keeps the provider's order.
 */
export function arrangeFavoritesFirst<T extends FavoriteCandidate>(
  models: ReadonlyArray<T>,
  favorites: ReadonlyArray<string>,
  keep: (model: T) => boolean,
  expanded: boolean,
): { readonly shown: ReadonlyArray<T>; readonly hidden: number } {
  const set = new Set(favorites);
  const starred = models.filter((model) => isFavoriteModel(model, set));
  // Nothing starred yet: there is nothing to put first, so show the list as is.
  if (starred.length === 0) return { shown: models, hidden: 0 };
  const others = models.filter((model) => !isFavoriteModel(model, set));
  if (expanded) return { shown: [...starred, ...others], hidden: 0 };
  const kept = others.filter(keep);
  return { shown: [...starred, ...kept], hidden: others.length - kept.length };
}
