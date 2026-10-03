import { useAtomValue } from "@effect/atom-react";
import type { GitListBranchesResult, GitStatusResult } from "@tabs/contracts";
import { Atom } from "@tabs/client-runtime/state";
import { useEffect } from "react";

import { environmentApi } from "../connection/environmentApiRegistry";
import { appAtomRegistry } from "./atomRegistry";

interface VcsSnapshot {
  readonly statusByCwd: Readonly<Record<string, GitStatusResult | undefined>>;
  readonly branchesByCwd: Readonly<Record<string, GitListBranchesResult | undefined>>;
  readonly errorsByCwd: Readonly<Record<string, Error | undefined>>;
}

const EMPTY_VCS_SNAPSHOT: VcsSnapshot = { statusByCwd: {}, branchesByCwd: {}, errorsByCwd: {} };

export const vcsSnapshotAtom = Atom.make(EMPTY_VCS_SNAPSHOT).pipe(
  Atom.withLabel("tabs-vcs-snapshot"),
  Atom.keepAlive,
);

const refreshes = new Map<string, Promise<void>>();

const vcsKey = (environmentId: string | undefined, cwd: string) =>
  JSON.stringify([environmentId ?? "primary", cwd]);

export function refreshVcs(cwd: string | null, environmentId?: string): Promise<void> {
  if (!cwd) return Promise.resolve();
  const key = vcsKey(environmentId, cwd);
  const active = refreshes.get(key);
  if (active) return active;
  const refresh = environmentApi(environmentId)
    .then((api) => Promise.all([api.git.status({ cwd }), api.git.listBranches({ cwd })]))
    .then(([status, branches]) => {
      appAtomRegistry.update(vcsSnapshotAtom, (snapshot) => ({
        statusByCwd: { ...snapshot.statusByCwd, [key]: status },
        branchesByCwd: { ...snapshot.branchesByCwd, [key]: branches },
        errorsByCwd: { ...snapshot.errorsByCwd, [key]: undefined },
      }));
    })
    .catch((cause: unknown) => {
      const error = cause instanceof Error ? cause : new Error("Unable to read Git state.");
      appAtomRegistry.update(vcsSnapshotAtom, (snapshot) => ({
        ...snapshot,
        errorsByCwd: { ...snapshot.errorsByCwd, [key]: error },
      }));
    })
    .finally(() => refreshes.delete(key));
  refreshes.set(key, refresh);
  return refresh;
}

export function useVcs(cwd: string | null, environmentId?: string) {
  const key = cwd ? vcsKey(environmentId, cwd) : null;
  const result = useAtomValue(vcsSnapshotAtom, (snapshot) =>
    key
      ? {
          status: snapshot.statusByCwd[key] ?? null,
          branches: snapshot.branchesByCwd[key] ?? null,
          error: snapshot.errorsByCwd[key] ?? null,
        }
      : { status: null, branches: null, error: null },
  );
  useEffect(() => {
    void refreshVcs(cwd, environmentId);
    if (!cwd) return;
    const interval = window.setInterval(() => void refreshVcs(cwd, environmentId), 15_000);
    return () => window.clearInterval(interval);
  }, [cwd, environmentId]);
  return result;
}
