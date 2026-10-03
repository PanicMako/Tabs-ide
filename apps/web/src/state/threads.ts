import type { Thread, Project } from "../types";
import { Atom } from "@tabs/client-runtime/state";

import { readModelStateAtom } from "./readModel";

/** Atom selectors used by chat surfaces while the read-model transport is migrated. */
export const threadsAtom = Atom.make(
  (get): readonly Thread[] => get(readModelStateAtom).threads,
).pipe(Atom.withLabel("tabs-threads"));

export const projectsAtom = Atom.make(
  (get): readonly Project[] => get(readModelStateAtom).projects,
).pipe(Atom.withLabel("tabs-projects"));

export const threadsHydratedAtom = Atom.make(
  (get): boolean => get(readModelStateAtom).threadsHydrated,
).pipe(Atom.withLabel("tabs-threads-hydrated"));

export const threadByIdAtom = (threadId: string) =>
  Atom.make(
    (get): Thread | null => get(threadsAtom).find((thread) => thread.id === threadId) ?? null,
  ).pipe(Atom.withLabel(`tabs-thread-${threadId}`));
