import { useAtomValue } from "@effect/atom-react";
import { Atom } from "@tabs/client-runtime/state";

import { appAtomRegistry } from "./atomRegistry";

export interface ThreadSelectionState {
  readonly selectedThreadKeys: ReadonlySet<string>;
  readonly anchorThreadKey: string | null;
}

const emptySelection: ThreadSelectionState = {
  selectedThreadKeys: new Set<string>(),
  anchorThreadKey: null,
};

export const threadSelectionAtom = Atom.make<ThreadSelectionState>(emptySelection).pipe(
  Atom.withLabel("tabs-thread-selection"),
  Atom.keepAlive,
);

function update(update: (state: ThreadSelectionState) => ThreadSelectionState) {
  appAtomRegistry.update(threadSelectionAtom, update);
}

export const threadSelectionActions = {
  toggle(threadKey: string) {
    update((state) => {
      const selectedThreadKeys = new Set(state.selectedThreadKeys);
      if (selectedThreadKeys.has(threadKey)) selectedThreadKeys.delete(threadKey);
      else selectedThreadKeys.add(threadKey);
      return {
        selectedThreadKeys,
        anchorThreadKey: selectedThreadKeys.has(threadKey) ? threadKey : state.anchorThreadKey,
      };
    });
  },
  rangeSelectTo(threadKey: string, orderedThreadKeys: readonly string[]) {
    update((state) => {
      const selectedThreadKeys = new Set(state.selectedThreadKeys);
      const anchor = state.anchorThreadKey;
      if (anchor === null) {
        selectedThreadKeys.add(threadKey);
        return { selectedThreadKeys, anchorThreadKey: threadKey };
      }
      const anchorIndex = orderedThreadKeys.indexOf(anchor);
      const targetIndex = orderedThreadKeys.indexOf(threadKey);
      if (anchorIndex === -1 || targetIndex === -1) {
        selectedThreadKeys.add(threadKey);
        return { selectedThreadKeys, anchorThreadKey: threadKey };
      }
      for (
        let index = Math.min(anchorIndex, targetIndex);
        index <= Math.max(anchorIndex, targetIndex);
        index += 1
      ) {
        const key = orderedThreadKeys[index];
        if (key !== undefined) selectedThreadKeys.add(key);
      }
      return { selectedThreadKeys, anchorThreadKey: anchor };
    });
  },
  clear() {
    const state = appAtomRegistry.get(threadSelectionAtom);
    if (state.selectedThreadKeys.size > 0 || state.anchorThreadKey !== null) {
      appAtomRegistry.set(threadSelectionAtom, emptySelection);
    }
  },
  remove(threadKeys: readonly string[]) {
    const removals = new Set(threadKeys);
    update((state) => {
      const selectedThreadKeys = new Set(
        [...state.selectedThreadKeys].filter((key) => !removals.has(key)),
      );
      if (
        selectedThreadKeys.size === state.selectedThreadKeys.size &&
        !removals.has(state.anchorThreadKey ?? "")
      )
        return state;
      return {
        selectedThreadKeys,
        anchorThreadKey:
          state.anchorThreadKey !== null && removals.has(state.anchorThreadKey)
            ? null
            : state.anchorThreadKey,
      };
    });
  },
  setAnchor(threadKey: string) {
    update((state) =>
      state.anchorThreadKey === threadKey ? state : { ...state, anchorThreadKey: threadKey },
    );
  },
};

export function useThreadSelection() {
  return useAtomValue(threadSelectionAtom);
}
