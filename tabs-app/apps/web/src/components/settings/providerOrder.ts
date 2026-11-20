/**
 * Provider order for Settings → Providers. The saved order lists provider ids
 * the user arranged; ids it does not mention (new providers, or an empty order)
 * keep their built-in position after the arranged ones, so adding a provider
 * never reshuffles a list someone already sorted.
 */
export function applyProviderOrder<T extends { readonly id: string }>(
  entries: readonly T[],
  savedOrder: readonly string[] | null | undefined,
): T[] {
  if (!savedOrder || savedOrder.length === 0) return [...entries];
  const rank = new Map<string, number>();
  for (const id of savedOrder) if (!rank.has(id)) rank.set(id, rank.size);
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const a = rank.get(left.entry.id);
      const b = rank.get(right.entry.id);
      if (a !== undefined && b !== undefined) return a - b;
      if (a !== undefined) return -1;
      if (b !== undefined) return 1;
      return left.index - right.index;
    })
    .map(({ entry }) => entry);
}

/**
 * Moves `activeId` to where `overId` sits in the full order. Works the same
 * whether the drag happened in the full list or a filtered one (for example
 * only enabled providers): hidden providers keep their places.
 */
export function moveProvider(
  orderedIds: readonly string[],
  activeId: string,
  overId: string,
): string[] {
  const from = orderedIds.indexOf(activeId);
  const to = orderedIds.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return [...orderedIds];
  const next = [...orderedIds];
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
}

/** True when the user arranged the list differently from the built-in order. */
export function isCustomProviderOrder(
  defaultIds: readonly string[],
  savedOrder: readonly string[] | null | undefined,
): boolean {
  const arranged = applyProviderOrder(
    defaultIds.map((id) => ({ id })),
    savedOrder,
  ).map(({ id }) => id);
  return arranged.some((id, index) => id !== defaultIds[index]);
}
