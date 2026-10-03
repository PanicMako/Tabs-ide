import { useAtomValue } from "@effect/atom-react";
import type { ThreadId } from "@tabs/contracts";
import { Atom } from "@tabs/client-runtime/state";

import { appAtomRegistry } from "./atomRegistry";
import { DEFAULT_THREAD_TERMINAL_ID } from "../types";
import {
  closeThreadTerminal,
  createDefaultThreadTerminalState,
  newThreadTerminal,
  selectThreadTerminalState,
  setThreadActiveTerminal,
  setThreadTerminalActivity,
  setThreadTerminalHeight,
  setThreadTerminalOpen,
  splitThreadTerminal,
  type ThreadTerminalState,
  updateTerminalStateByThreadId,
} from "./terminalTransitions";

const STORAGE_KEY = "tabs:terminal-state:v1";
export interface TerminalState {
  readonly terminalStateByThreadId: Record<ThreadId, ThreadTerminalState>;
}

function load(): TerminalState {
  if (typeof localStorage === "undefined") return { terminalStateByThreadId: {} };
  try {
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as {
      terminalStateByThreadId?: Record<ThreadId, ThreadTerminalState>;
    } | null;
    return {
      terminalStateByThreadId: Object.fromEntries(
        Object.entries(persisted?.terminalStateByThreadId ?? {}).map(([id, state]) => [
          id,
          { ...state, runningTerminalIds: [] },
        ]),
      ) as Record<ThreadId, ThreadTerminalState>,
    };
  } catch {
    return { terminalStateByThreadId: {} };
  }
}

export const terminalStateAtom = Atom.make<TerminalState>(load()).pipe(
  Atom.withLabel("tabs-terminal-state"),
  Atom.keepAlive,
);

function persist(state: TerminalState) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      terminalStateByThreadId: Object.fromEntries(
        Object.entries(state.terminalStateByThreadId).map(([id, value]) => [
          id,
          { ...value, runningTerminalIds: [] },
        ]),
      ),
    }),
  );
}

function updateThread(
  threadId: ThreadId,
  updater: (state: ThreadTerminalState) => ThreadTerminalState,
) {
  appAtomRegistry.update(terminalStateAtom, (state) => {
    const terminalStateByThreadId = updateTerminalStateByThreadId(
      state.terminalStateByThreadId,
      threadId,
      updater,
    );
    if (terminalStateByThreadId === state.terminalStateByThreadId) return state;
    const next = { terminalStateByThreadId };
    persist(next);
    return next;
  });
}

export function useThreadTerminalState(threadId: ThreadId | null) {
  return useAtomValue(terminalStateAtom, (state) =>
    threadId ? selectThreadTerminalState(state.terminalStateByThreadId, threadId) : null,
  );
}

export function getThreadTerminalState(threadId: ThreadId) {
  return selectThreadTerminalState(
    appAtomRegistry.get(terminalStateAtom).terminalStateByThreadId,
    threadId,
  );
}

export const terminalActions = {
  activity: (threadId: ThreadId, terminalId: string, running: boolean, label?: string) =>
    updateThread(threadId, (state) => setThreadTerminalActivity(state, terminalId, running, label)),
  clear: (threadId: ThreadId) => updateThread(threadId, createDefaultThreadTerminalState),
  close: (threadId: ThreadId, terminalId: string) =>
    updateThread(threadId, (state) => closeThreadTerminal(state, terminalId)),
  new: (threadId: ThreadId, terminalId: string) =>
    updateThread(threadId, (state) => newThreadTerminal(state, terminalId)),
  setActive: (threadId: ThreadId, terminalId: string) =>
    updateThread(threadId, (state) => setThreadActiveTerminal(state, terminalId)),
  setHeight: (threadId: ThreadId, height: number) =>
    updateThread(threadId, (state) => setThreadTerminalHeight(state, height)),
  setOpen: (threadId: ThreadId, open: boolean) =>
    updateThread(threadId, (state) => setThreadTerminalOpen(state, open)),
  split: (threadId: ThreadId, terminalId: string) =>
    updateThread(threadId, (state) => splitThreadTerminal(state, terminalId)),
  removeOrphans(activeThreadIds: Set<ThreadId>) {
    appAtomRegistry.update(terminalStateAtom, (state) => {
      const terminalStateByThreadId = Object.fromEntries(
        Object.entries(state.terminalStateByThreadId).filter(([id]) =>
          activeThreadIds.has(id as ThreadId),
        ),
      ) as Record<ThreadId, ThreadTerminalState>;
      if (
        Object.keys(terminalStateByThreadId).length ===
        Object.keys(state.terminalStateByThreadId).length
      )
        return state;
      const next = { terminalStateByThreadId };
      persist(next);
      return next;
    });
  },
  reconcileRunning(activeTerminalIds: Set<string>) {
    appAtomRegistry.update(terminalStateAtom, (state) => ({
      terminalStateByThreadId: Object.fromEntries(
        Object.entries(state.terminalStateByThreadId).map(([id, terminalState]) => {
          let nextState = terminalState;
          for (const terminalId of terminalState.terminalIds) {
            if (!activeTerminalIds.has(terminalId) && terminalId !== DEFAULT_THREAD_TERMINAL_ID) {
              nextState = closeThreadTerminal(nextState, terminalId);
            }
          }
          return [
            id,
            {
              ...nextState,
              runningTerminalIds: nextState.runningTerminalIds.filter((key) =>
                activeTerminalIds.has(key),
              ),
            },
          ];
        }),
      ) as Record<ThreadId, ThreadTerminalState>,
    }));
  },
};
