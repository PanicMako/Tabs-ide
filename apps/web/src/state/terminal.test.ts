import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadId } from "@tabs/contracts";

import { appAtomRegistry } from "./atomRegistry";
import { terminalActions, terminalStateAtom } from "./terminal";

const THREAD_ID = ThreadId.makeUnsafe("thread-1");

describe("terminal atoms", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
    appAtomRegistry.set(terminalStateAtom, { terminalStateByThreadId: {} });
  });

  it("opens and splits terminals in the active group", () => {
    terminalActions.setOpen(THREAD_ID, true);
    terminalActions.split(THREAD_ID, "terminal-2");
    const terminal = appAtomRegistry.get(terminalStateAtom).terminalStateByThreadId[THREAD_ID];
    expect(terminal?.terminalOpen).toBe(true);
    expect(terminal?.terminalGroups).toEqual([
      { id: "group-default", terminalIds: ["default", "terminal-2"] },
    ]);
  });

  it("removes orphaned terminal state", () => {
    terminalActions.setOpen(THREAD_ID, true);
    terminalActions.removeOrphans(new Set());
    expect(
      appAtomRegistry.get(terminalStateAtom).terminalStateByThreadId[THREAD_ID],
    ).toBeUndefined();
  });
});
