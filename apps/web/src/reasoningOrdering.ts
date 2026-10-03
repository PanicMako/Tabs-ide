import type { ProviderOptionChoice, ProviderOptionDescriptor } from "@tabs/contracts";

export const REASONING_LEVEL_RANKS: Readonly<Record<string, number>> = {
  none: 0,
  instant: 5,
  instantthink: 5,
  instantthinking: 5,
  low: 10,
  minimal: 15,
  medium: 20,
  high: 30,
  xhigh: 40,
  extrahigh: 40,
  max: 50,
  ultra: 60,
  ultracode: 70,
  ultrathink: 80,
  ultrathinking: 80,
};

/**
 * Returns numeric rank for known reasoning IDs, or a default high value for unknown IDs so they sort after known levels.
 */
export function getReasoningChoiceRank(id: string): number {
  const normalized = id.toLowerCase();
  if (normalized in REASONING_LEVEL_RANKS) {
    return REASONING_LEVEL_RANKS[normalized]!;
  }
  return 1000;
}

/**
 * Sorts reasoning choices dynamically while preserving full `ProviderOptionChoice` objects and metadata.
 * Known level IDs are sorted according to `REASONING_LEVEL_RANKS`.
 * Unknown level IDs are never discarded; they are sorted after known IDs deterministically.
 */
export function sortReasoningChoices<T extends { id: string }>(choices: ReadonlyArray<T>): T[] {
  if (!choices || choices.length <= 1) return [...choices];

  return [...choices].sort((a, b) => {
    const rankA = getReasoningChoiceRank(a.id);
    const rankB = getReasoningChoiceRank(b.id);

    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return a.id.localeCompare(b.id);
  });
}

export const DEFAULT_STANDARD_REASONING_CHOICES: ReadonlyArray<ProviderOptionChoice> = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra High" },
  { id: "max", label: "Max" },
  { id: "ultra", label: "Ultra" },
];

/**
 * Collects, deduplicates, and sorts unique reasoning effort choices across multiple provider option descriptor sets.
 * Operates purely on `ProviderOptionDescriptor` collections with zero coupling to model or provider types.
 * Falls back to standard default reasoning choices if no descriptors specify explicit options.
 */
export function collectReasoningChoices(
  descriptorSets: ReadonlyArray<ReadonlyArray<ProviderOptionDescriptor>>,
): ProviderOptionChoice[] {
  if (!descriptorSets || descriptorSets.length === 0) {
    return [...DEFAULT_STANDARD_REASONING_CHOICES];
  }

  const choicesMap = new Map<string, ProviderOptionChoice>();
  let hasAnyReasoningDescriptor = false;

  for (const descriptors of descriptorSets) {
    const primary = descriptors.find(
      (d) =>
        d.id === "reasoningEffort" ||
        d.id === "effort" ||
        d.id === "reasoning" ||
        d.id === "variant" ||
        d.id.toLowerCase().includes("effort") ||
        d.id.toLowerCase().includes("reasoning") ||
        d.id.toLowerCase().includes("variant"),
    );

    if (
      primary &&
      primary.type === "select" &&
      Array.isArray(primary.options) &&
      primary.options.length > 0
    ) {
      hasAnyReasoningDescriptor = true;
      for (const rawChoice of primary.options) {
        if (!rawChoice) continue;
        const choiceId = (rawChoice.id ?? (rawChoice as any).value)?.toString().trim();
        if (!choiceId) continue;
        const choiceLabel = rawChoice.label ?? choiceId;
        if (!choicesMap.has(choiceId)) {
          choicesMap.set(choiceId, {
            id: choiceId,
            label: choiceLabel,
            ...(rawChoice.isDefault !== undefined ? { isDefault: rawChoice.isDefault } : {}),
          });
        }
      }
    }
  }

  if (choicesMap.size === 0) {
    return hasAnyReasoningDescriptor ? [...DEFAULT_STANDARD_REASONING_CHOICES] : [];
  }

  return sortReasoningChoices(Array.from(choicesMap.values()));
}

/**
 * Splits and formats thinking level labels for multi-line display to prevent header text overlap in matrix grids.
 * Compound terms like `Ultrathink`, `Ultracode`, `InstantThinking`, and `XHigh` are split across multiple lines cleanly.
 */
export function formatThinkingHeaderWords(stop: { id: string; label?: string }): string[] {
  const raw = (stop.label || stop.id).trim();
  const normalized = raw
    .replace(/^x[-_]?high$/i, "Extra High")
    .replace(/^extra[-_]?high$/i, "Extra High")
    .replace(/^ultra[-_]?think(ing)?$/i, "Ultra Think")
    .replace(/^ultra[-_]?code(r?)$/i, "Ultra Code$1")
    .replace(/^instant[-_]?think(ing)?$/i, "Instant Think")
    .replace(/^fast[-_]?think(ing)?$/i, "Fast Think")
    .replace(/^deep[-_]?think(ing)?$/i, "Deep Think")
    .replace(/^high[-_]?reasoning$/i, "High Reasoning")
    .replace(/^low[-_]?reasoning$/i, "Low Reasoning")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ");

  const words = normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toUpperCase());

  if (words.length <= 2) {
    return words;
  }
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}
