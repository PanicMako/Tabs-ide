/** Resolve old unscoped links only when they identify one unambiguous thread. */
export function resolveRouteThread<T extends { id: string; environmentId?: string | undefined }>(
  threads: readonly T[],
  threadId: string | null,
  environmentId: string | null,
): T | null {
  if (!threadId) return null;
  const matches = threads.filter(
    (thread) =>
      thread.id === threadId && (environmentId === null || thread.environmentId === environmentId),
  );
  return matches.length === 1 ? matches[0]! : null;
}
