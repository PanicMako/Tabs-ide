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
  // A sub-thread belongs to its lead's view. When the lead is in a section that
  // is not shown (done, snoozed, archived), the sub-thread stays hidden with it
  // instead of surfacing as a top-level thread here.
  const byId = new Map(allThreads.map((thread) => [thread.id, thread] as const));
  const hasKnownRoot = (thread: T): boolean => {
    const seen = new Set<string>([thread.id]);
    let current = thread;
    while (hasParent(current)) {
      const parent = byId.get(current.parentThreadId as string);
      if (!parent || seen.has(parent.id)) return false;
      seen.add(parent.id);
      current = parent;
    }
    return current.id !== thread.id;
  };
  // A parent cycle still shows up, so no thread is ever lost.
  for (const section of sections) {
    for (const thread of section.threads) {
      if (hasKnownRoot(thread)) continue;
      visit(thread, section.name, 0, false);
    }
  }
  return out;
}

export interface SidebarThread extends TreeThread {
  readonly title: string;
  readonly isSubagent?: boolean | undefined;
}

const OVERMIND_PREFIX = "Overmind · ";

/**
 * Plain sub-agents are side helpers of the thread that started them, as in
 * any agent CLI: they stay out of the thread list and are reached from the
 * parent's Agents pane. Overmind tasks are real work threads and stay nested.
 * A helper's own descendants are hidden with it.
 */
export function splitSidebarHelpers<T extends SidebarThread>(
  threads: ReadonlyArray<T>,
): { readonly listed: ReadonlyArray<T>; readonly helpersByParent: ReadonlyMap<string, T[]> } {
  const byId = new Map(threads.map((thread) => [thread.id, thread] as const));
  const isHelper = (thread: T) =>
    thread.isSubagent === true &&
    !thread.title.startsWith(OVERMIND_PREFIX) &&
    (thread.parentThreadId ?? null) !== null;
  const hidden = new Map<string, boolean>();
  const isHidden = (thread: T, seen: Set<string>): boolean => {
    const known = hidden.get(thread.id);
    if (known !== undefined) return known;
    let result = isHelper(thread);
    const parentId = thread.parentThreadId ?? null;
    if (!result && parentId !== null && !seen.has(parentId)) {
      const parent = byId.get(parentId);
      seen.add(thread.id);
      result = parent !== undefined && isHidden(parent, seen);
    }
    hidden.set(thread.id, result);
    return result;
  };
  const listed: T[] = [];
  const helpersByParent = new Map<string, T[]>();
  for (const thread of threads) {
    if (!isHidden(thread, new Set())) {
      listed.push(thread);
      continue;
    }
    if (!isHelper(thread)) continue;
    const parentId = thread.parentThreadId as string;
    const list = helpersByParent.get(parentId);
    if (list) list.push(thread);
    else helpersByParent.set(parentId, [thread]);
  }
  return { listed, helpersByParent };
}

/** How one listed row draws the open thread when it sits inside a family. */
export interface ThreadPathMark {
  /** The open thread itself: its title is lit. */
  readonly selected: boolean;
  /** The top-level thread of the open thread's family: it keeps the left bar. */
  readonly familyBar: boolean;
  /** This row's elbow is part of the path down to the open thread. */
  readonly elbowLit: boolean;
  /** This row's vertical guide carries the path past it to a later sibling. */
  readonly railLit: boolean;
}

const NO_MARK: ThreadPathMark = {
  selected: false,
  familyBar: false,
  elbowLit: false,
  railLit: false,
};

/**
 * Marks for the rows between the open thread and its top-level ancestor, so
 * the sidebar can draw one lit path: the family's left bar, then the tree
 * guide down to the open sub-thread, whose title alone is highlighted. Rows
 * not on the path get no mark. `entries` is the emitted tree, in order.
 */
export function markActiveThreadPath<T extends TreeThread>(
  entries: ReadonlyArray<{ readonly kind: string; readonly thread: T; readonly depth: number }>,
  allThreads: ReadonlyArray<T>,
  activeId: string | null | undefined,
): (threadId: string) => ThreadPathMark {
  if (!activeId) return () => NO_MARK;
  const byId = new Map(allThreads.map((thread) => [thread.id, thread] as const));
  // Root first: [root, ..., parent, active].
  const path: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(activeId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.id);
    const parentId = current.parentThreadId ?? null;
    current = parentId === null ? undefined : byId.get(parentId);
  }
  if (path.length === 0) return () => NO_MARK;
  const onPath = new Set(path);
  const nextOnPath = new Map<string, string>();
  for (let index = 0; index < path.length - 1; index += 1) {
    nextOnPath.set(path[index]!, path[index + 1]!);
  }
  const rowIndex = new Map<string, number>();
  entries.forEach((entry, index) => {
    if (entry.kind === "thread") rowIndex.set(entry.thread.id, index);
  });
  const rootId = path[0]!;
  return (threadId) => {
    const thread = byId.get(threadId);
    const index = rowIndex.get(threadId);
    if (!thread || index === undefined) return NO_MARK;
    const selected = threadId === activeId;
    const familyBar = threadId === rootId && !selected;
    const depth = entries[index]!.depth;
    const elbowLit = depth > 0 && onPath.has(threadId);
    const parentId = thread.parentThreadId ?? null;
    const pathChild = parentId === null ? undefined : nextOnPath.get(parentId);
    const pathChildIndex = pathChild === undefined ? undefined : rowIndex.get(pathChild);
    const railLit =
      depth > 0 && pathChildIndex !== undefined && index < pathChildIndex && !onPath.has(threadId);
    if (!selected && !familyBar && !elbowLit && !railLit) return NO_MARK;
    return { selected, familyBar, elbowLit, railLit };
  };
}
