/**
 * Default model shortlist for the picker: the newest model of each family, plus
 * anything pinned or currently selected. Everything else stays one click away
 * behind "Show more", so the list is not a wall of superseded models.
 */

interface CuratableModel {
  readonly slug: string;
  readonly name: string;
}

const VERSION_PATTERN = /\d+(?:[.\-_]\d+)*/;

function familyKey(model: CuratableModel): string {
  return model.name
    .toLowerCase()
    .replace(/\d+(?:[.\-_]\d+)*/g, " ")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

function versionOf(model: CuratableModel): ReadonlyArray<number> {
  const match = VERSION_PATTERN.exec(model.name) ?? VERSION_PATTERN.exec(model.slug);
  if (!match) return [];
  return match[0].split(/[.\-_]/).map((part) => Number(part));
}

function compareVersions(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Below this many models there is nothing worth hiding. */
export const MIN_MODELS_TO_CURATE = 6;

export function curateModels<T extends CuratableModel>(
  models: ReadonlyArray<T>,
  keep: (model: T) => boolean,
): { readonly shown: ReadonlyArray<T>; readonly hidden: number } {
  if (models.length < MIN_MODELS_TO_CURATE) return { shown: models, hidden: 0 };
  const newest = new Map<string, ReadonlyArray<number>>();
  for (const model of models) {
    const key = familyKey(model);
    const version = versionOf(model);
    const current = newest.get(key);
    if (!current || compareVersions(version, current) > 0) newest.set(key, version);
  }
  const shown = models.filter((model) => {
    if (keep(model)) return true;
    return compareVersions(versionOf(model), newest.get(familyKey(model)) ?? []) === 0;
  });
  return { shown, hidden: models.length - shown.length };
}
