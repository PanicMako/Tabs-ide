// Adapted from Orca (MIT, (c) 2026 Lovecast Inc.) — src/main/computer/computer-snapshot-tree-diff.ts
import {
  joinComputerTreeText,
  parseComputerTreeText,
  type ComputerTreeElement,
} from "./treeText.ts";

const MAX_BASELINES = 32;
// Older element indexes are refused by actions anyway, so a baseline past this age is dropped.
const MAX_BASELINE_AGE_MS = 2 * 60 * 1000;
// A diff that rewrites most of the tree is harder to read than the tree itself.
const MAX_DIFF_TO_FULL_RATIO = 0.5;

export interface ComputerTreeDiff {
  readonly text: string;
  readonly changed: number;
  readonly added: number;
  readonly removed: number;
}

/**
 * Describes `next` as changes against `previous`. Returns null whenever the diff could hide where
 * a control lives (added, moved or re-parented elements) or would not be shorter than the tree.
 */
export function diffComputerTreeText(previous: string, next: string): ComputerTreeDiff | null {
  const before = parseComputerTreeText(previous);
  const after = parseComputerTreeText(next);
  if (before.elements.length === 0 || after.elements.length === 0) {
    return null;
  }
  const beforeParents = elementParents(before.elements);
  const afterParents = elementParents(after.elements);
  const afterIndexes = new Set(after.elements.map((element) => element.index));
  const retainedBefore = before.elements.filter((element) => afterIndexes.has(element.index));
  const body: string[] = [];
  let changed = 0;
  for (const [position, element] of after.elements.entries()) {
    const old = retainedBefore[position];
    if (
      !old ||
      old.index !== element.index ||
      old.depth !== element.depth ||
      beforeParents.get(element.index) !== afterParents.get(element.index)
    ) {
      return null;
    }
    if (old.lines.join("\n") !== element.lines.join("\n")) {
      changed += 1;
      body.push(...element.lines.map((line) => `~ ${line}`));
    }
  }
  const removedIndexes = before.elements
    .map((element) => element.index)
    .filter((index) => !afterIndexes.has(index));
  if (removedIndexes.length > 0) {
    body.push(`- ${formatIndexRanges(removedIndexes)}`);
  }
  const summary = { changed, added: 0, removed: removedIndexes.length };
  if (body.length === 0) {
    return {
      ...summary,
      text: joinComputerTreeText(
        after.header,
        ["No change in the accessibility tree since the previous snapshot."],
        after.footer,
      ),
    };
  }
  const text = joinComputerTreeText(
    after.header,
    [
      "Changes since the previous snapshot (~ changed, - removed). Unchanged elements are omitted and keep their indexes.",
      ...body,
    ],
    after.footer,
  );
  return text.length > next.length * MAX_DIFF_TO_FULL_RATIO ? null : { ...summary, text };
}

function elementParents(
  elements: ReadonlyArray<ComputerTreeElement>,
): Map<number, number | undefined> {
  const parents = new Map<number, number | undefined>();
  const path: number[] = [];
  for (const element of elements) {
    path.length = Math.min(path.length, element.depth);
    parents.set(element.index, path.at(-1));
    path[element.depth] = element.index;
  }
  return parents;
}

export function formatIndexRanges(indexes: ReadonlyArray<number>): string {
  const sorted = [...indexes].toSorted((a, b) => a - b);
  const first = sorted[0];
  if (first === undefined) return "";
  const ranges: string[] = [];
  let start = first;
  let end = first;
  const flush = () => ranges.push(start === end ? String(start) : `${start}-${end}`);
  for (const index of sorted.slice(1)) {
    if (index === end + 1) {
      end = index;
      continue;
    }
    flush();
    start = index;
    end = index;
  }
  flush();
  return ranges.join(", ");
}

export interface DiffableSnapshot {
  /** Namespace for the baseline, such as the calling thread. */
  readonly session: string;
  readonly pid: number;
  readonly windowKey: string;
  readonly snapshotId: string;
  readonly treeText: string;
}

export interface AppliedDiff {
  readonly treeText: string;
  readonly diff?: {
    readonly baseSnapshotId: string;
    readonly changed: number;
    readonly removed: number;
  };
}

/** Remembers the last full tree returned per session and app process. */
export class ComputerTreeBaselines {
  private readonly entries = new Map<
    string,
    { windowKey: string; snapshotId: string; treeText: string; createdAtMs: number }
  >();

  constructor(private readonly now: () => number = Date.now) {}

  /** Records `snapshot` as the new baseline and returns a diff against the previous one when it helps. */
  apply(snapshot: DiffableSnapshot, wantDiff: boolean): AppliedDiff {
    const key = `${snapshot.session}\u0000${snapshot.pid}`;
    this.prune();
    const previous = this.entries.get(key);
    this.entries.delete(key);
    this.entries.set(key, {
      windowKey: snapshot.windowKey,
      snapshotId: snapshot.snapshotId,
      treeText: snapshot.treeText,
      createdAtMs: this.now(),
    });
    if (!wantDiff || !previous || previous.windowKey !== snapshot.windowKey) {
      return { treeText: snapshot.treeText };
    }
    const diff = diffComputerTreeText(previous.treeText, snapshot.treeText);
    if (!diff) return { treeText: snapshot.treeText };
    return {
      treeText: diff.text,
      diff: { baseSnapshotId: previous.snapshotId, changed: diff.changed, removed: diff.removed },
    };
  }

  private prune(): void {
    const cutoff = this.now() - MAX_BASELINE_AGE_MS;
    for (const [key, entry] of this.entries) {
      if (this.entries.size > MAX_BASELINES || entry.createdAtMs < cutoff) {
        this.entries.delete(key);
      }
    }
  }
}
