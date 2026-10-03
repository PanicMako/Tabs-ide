import { beforeEach, describe, expect, it } from "vitest";
import { EnvironmentId, ThreadId } from "@tabs/contracts";
import { scopedThreadKey, scopeThreadRef } from "@tabs/client-runtime/environment";

import { appAtomRegistry } from "./atomRegistry";
import { threadSelectionActions, threadSelectionAtom } from "./threadSelection";

const ENVIRONMENT = EnvironmentId.makeUnsafe("environment-a");
const key = (id: string) => scopedThreadKey(scopeThreadRef(ENVIRONMENT, ThreadId.makeUnsafe(id)));
const A = key("thread-a");
const B = key("thread-b");
const C = key("thread-c");

describe("thread selection atoms", () => {
  beforeEach(() => {
    appAtomRegistry.set(threadSelectionAtom, {
      selectedThreadKeys: new Set<string>(),
      anchorThreadKey: null,
    });
  });

  it("toggles a selection and records its anchor", () => {
    threadSelectionActions.toggle(A);
    expect(appAtomRegistry.get(threadSelectionAtom)).toEqual({
      selectedThreadKeys: new Set([A]),
      anchorThreadKey: A,
    });
    threadSelectionActions.toggle(A);
    expect(appAtomRegistry.get(threadSelectionAtom).selectedThreadKeys).toEqual(new Set());
  });

  it("selects an inclusive range from the anchor", () => {
    threadSelectionActions.toggle(A);
    threadSelectionActions.rangeSelectTo(C, [A, B, C]);
    expect(appAtomRegistry.get(threadSelectionAtom)).toEqual({
      selectedThreadKeys: new Set([A, B, C]),
      anchorThreadKey: A,
    });
  });

  it("removes deleted threads and clears a removed anchor", () => {
    threadSelectionActions.toggle(A);
    threadSelectionActions.toggle(B);
    threadSelectionActions.remove([B]);
    expect(appAtomRegistry.get(threadSelectionAtom)).toEqual({
      selectedThreadKeys: new Set([A]),
      anchorThreadKey: null,
    });
  });

  it("keeps identical local thread ids in different environments distinct", () => {
    const localId = ThreadId.makeUnsafe("shared-thread");
    const first = scopedThreadKey(scopeThreadRef(ENVIRONMENT, localId));
    const second = scopedThreadKey(
      scopeThreadRef(EnvironmentId.makeUnsafe("environment-b"), localId),
    );

    threadSelectionActions.toggle(first);
    threadSelectionActions.toggle(second);

    expect(appAtomRegistry.get(threadSelectionAtom).selectedThreadKeys).toEqual(
      new Set([first, second]),
    );
  });
});
