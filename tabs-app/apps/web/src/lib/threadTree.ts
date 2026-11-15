/**
 * Arranges sidebar threads as a tree: a delegated sub-thread is drawn under the
 * thread that delegated it, whatever state each one is in. A parent keeps its
 * children together, so a finished sub-thread does not drift into "Wrapped"
 * while its lead is still in "Active". A parent can be collapsed to a single
 * "N nested" line. Pure and stable: siblings keep their input order.
 */
export interface TreeThread {
  readonly id: string;
  readonly parentThreadId?: string | null | undefined;
}

export interface TreeSection<T extends TreeThread, S extends string> {
  readonly name: S;
  readonly threads: ReadonlyArray<T>;
}

export type TreeEntry<T extends TreeThread, S extends string> =
  | {
      readonly kind: "thread";
      readonly thread: T;
      readonly section: S;
      readonly depth: number;
      readonly lastChild: boolean;
      readonly childCount: number;
      readonly collapsed: boolean;
    }
  | {
      /** The "N nested" line standing in for a collapsed parent's children. */
      readonly kind: "summary";
      readonly thread: T;
      readonly section: S;
      readonly depth: number;
      readonly count: number;
    };

const MAX_DEPTH = 3;

export function buildThreadTree<T extends TreeThread, S extends string>(
  sections: ReadonlyArray<TreeSection<T, S>>,
  allThreads: ReadonlyArray<T>,
  collapsedIds: ReadonlySet<string>,
): ReadonlyArray<TreeEntry<T, S>> {
  const known = new Set(allThreads.map((thread) => thread.id));
  const hasParent = (thread: T): boolean => {
    const parent = thread.parentThreadId ?? null;
    return parent !== null && parent !== thread.id && known.has(parent);
  };
  const childrenOf = new Map<string, T[]>();
  for (const thread of allThreads) {
    if (!hasParent(thread)) continue;
    const parent = thread.parentThreadId as string;
    const list = childrenOf.get(parent);
    if (list) list.push(thread);
    else childrenOf.set(parent, [thread]);
  }
  const countDescendants = (id: string, seen: Set<string>): number => {
    let total = 0;
    for (const child of childrenOf.get(id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      total += 1 + countDescendants(child.id, seen);
    }
    return total;
  };

  const out: TreeEntry<T, S>[] = [];
  const emitted = new Set<string>();
  const visit = (thread: T, section: S, depth: number, lastChild: boolean) => {
    if (emitted.has(thread.id)) return;
    emitted.add(thread.id);
    const children = childrenOf.get(thread.id) ?? [];
    const collapsed = children.length > 0 && collapsedIds.has(thread.id);
    out.push({
      kind: "thread",
      thread,
      section,
      depth: Math.min(depth, MAX_DEPTH),
      lastChild,
      childCount: children.length,
      collapsed,
    });
    if (collapsed) {
      // Hidden children count as shown, so the leftover sweep below skips them.
      const hide = (id: string) => {
        for (const child of childrenOf.get(id) ?? []) {
          if (emitted.has(child.id)) continue;
          emitted.add(child.id);
          hide(child.id);
        }
      };
      hide(thread.id);
      out.push({
        kind: "summary",
        thread,
        section,
        depth: Math.min(depth + 1, MAX_DEPTH),
        count: countDescendants(thread.id, new Set([thread.id])),
      });
      return;
    }
    children.forEach((child, index) =>
      visit(child, section, depth + 1, index === children.length - 1),
    );
  };

  for (const section of sections) {
    for (const thread of section.threads) {
      if (!hasParent(thread)) visit(thread, section.name, 0, false);
    }
  }
  // A thread whose parent is in no section, or a parent cycle, still shows up.
  for (const section of sections) {
    for (const thread of section.threads) visit(thread, section.name, 0, false);
  }
  return out;
}
