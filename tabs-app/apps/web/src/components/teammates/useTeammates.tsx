import type {
  Teammate,
  TeammateId,
  TeammatePatch,
  TeammatesCreateInput,
  ThreadId,
} from "@tabs/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useCallback, useMemo } from "react";
import { useConfirm } from "~/hooks/useConfirm";
import { useSettings } from "~/hooks/useSettings";
import { readModelStateAtom } from "~/state/readModel";
import { attempt, teammatesApi } from "./teammatesActions";
import {
  activityFor,
  defaultTeammateName,
  resolveActiveTeammate,
  type WorkerState,
} from "./teammates.logic";
import { useTeammatesStore, useTeammatesUiStore } from "./teammatesStore";

export function useTeammatesEnabled(): boolean {
  return useSettings((settings) => settings.teammatesEnabled);
}

const NO_TEAMMATES: ReadonlyArray<Teammate> = [];

/** The live snapshot plus the focused teammate. Empty until the host subscribes. */
export function useTeammatesData() {
  const snapshot = useTeammatesStore((state) => state.snapshot);
  const preferredId = useTeammatesUiStore((state) => state.activeTeammateId);
  const teammates = snapshot?.teammates ?? NO_TEAMMATES;
  const active = resolveActiveTeammate(teammates, preferredId);
  const pinnedId = useTeammatesUiStore((state) => state.pinnedTeammateId);
  return {
    snapshot,
    teammates,
    active,
    pinned: resolveActiveTeammate(teammates, pinnedId),
    activity: active ? activityFor(snapshot?.activity ?? [], active.id) : null,
  };
}

/** Create, rename, update and delete (with confirmation) shared by the panel and Settings. */
export function useTeammateManagement() {
  const { confirm, confirmDialog } = useConfirm();
  const { teammates } = useTeammatesData();
  const setActive = useTeammatesUiStore((state) => state.setActiveTeammateId);

  const nextName = useMemo(() => defaultTeammateName(teammates), [teammates]);

  const create = useCallback(
    async (input: TeammatesCreateInput) => {
      const result = await attempt("Could not add the teammate", () =>
        teammatesApi().create(input),
      );
      if (result) setActive(result.teammate.id);
      return result?.teammate ?? null;
    },
    [setActive],
  );
  const update = useCallback(
    (id: TeammateId, patch: TeammatePatch) =>
      attempt("Could not update the teammate", () => teammatesApi().update({ id, patch })),
    [],
  );
  const remove = useCallback(
    async (teammate: Pick<Teammate, "id" | "name">) => {
      const ok = await confirm(
        `Delete ${teammate.name}?\n\nRemoved for good: its memory, its soul, its to-dos and its ideas. Its chat with you is archived.\n\nKept: the threads its workers started, and any code they wrote.`,
      );
      if (!ok) return false;
      const result = await attempt("Could not delete the teammate", () =>
        teammatesApi().delete({ id: teammate.id }),
      );
      return result !== null;
    },
    [confirm],
  );
  return { nextName, create, update, remove, confirmDialog };
}

const NO_WORKERS: ReadonlyMap<string, WorkerState> = new Map();

/** The live state of worker threads by id, read from the shared read model. */
export function useWorkerStates(ids: ReadonlyArray<ThreadId>): ReadonlyMap<string, WorkerState> {
  const threads = useAtomValue(readModelStateAtom, (state) => state.threads);
  return useMemo(() => {
    if (ids.length === 0) return NO_WORKERS;
    const wanted = new Set<string>(ids);
    const found = new Map<string, WorkerState>();
    for (const thread of threads) {
      if (!wanted.has(thread.id)) continue;
      found.set(thread.id, {
        title: thread.title,
        running: Boolean(thread.activeRunId) || thread.session?.status === "running",
        failed: thread.session?.status === "error",
      });
    }
    return found;
  }, [ids, threads]);
}
