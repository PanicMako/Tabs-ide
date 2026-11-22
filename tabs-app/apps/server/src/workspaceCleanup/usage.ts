/** What Tabs itself knows about a worktree: threads, sessions, terminals and project roots. */
export interface WorkspaceUsageIndex {
  readonly threads: ReadonlyArray<{
    readonly path: string;
    readonly settled: boolean;
    readonly activityAt: number | null;
  }>;
  readonly sessionCwds: ReadonlyArray<string>;
  readonly terminals: ReadonlyArray<{
    readonly cwd: string;
    readonly running: boolean;
    readonly updatedAt: number | null;
  }>;
  readonly projectRoots: ReadonlyArray<string>;
}

export const EMPTY_USAGE: WorkspaceUsageIndex = {
  threads: [],
  sessionCwds: [],
  terminals: [],
  projectRoots: [],
};

export const isInside = (parent: string, child: string) =>
  child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);

export interface WorkspaceUsage {
  readonly openThreads: number;
  readonly settledThreads: number;
  readonly liveSessions: number;
  readonly runningTerminals: number;
  readonly lastThreadActivityAt: number | null;
  readonly lastTerminalActivityAt: number | null;
  readonly projectRoot: boolean;
}

const maxOrNull = (values: ReadonlyArray<number | null>) => {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : Math.max(...present);
};

/** Paths in `index` must already be canonical, with `/` separators on every platform. */
export function usageFor(index: WorkspaceUsageIndex, root: string): WorkspaceUsage {
  const threads = index.threads.filter((thread) => isInside(root, thread.path));
  const terminals = index.terminals.filter((terminal) => isInside(root, terminal.cwd));
  return {
    openThreads: threads.filter((thread) => !thread.settled).length,
    settledThreads: threads.filter((thread) => thread.settled).length,
    liveSessions: index.sessionCwds.filter((cwd) => isInside(root, cwd)).length,
    runningTerminals: terminals.filter((terminal) => terminal.running).length,
    lastThreadActivityAt: maxOrNull(threads.map((thread) => thread.activityAt)),
    lastTerminalActivityAt: maxOrNull(terminals.map((terminal) => terminal.updatedAt)),
    projectRoot: index.projectRoots.some((projectRoot) => isInside(root, projectRoot)),
  };
}
