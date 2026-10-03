import { ProjectId, ThreadId } from "@tabs/contracts";

interface TerminalRetentionThread {
  id: ThreadId;
  deletedAt: string | null;
}

interface CollectActiveTerminalThreadIdsInput {
  snapshotThreads: readonly TerminalRetentionThread[];
  draftThreadIds: Iterable<ThreadId>;
  /**
   * IDs of all known projects. Synthetic terminal thread IDs for the server
   * tab (`server:<projectId>`) and git tab (`git:<projectId>`) are derived
   * from these and marked active so the orphan-cleanup never wipes them —
   * these IDs are never part of the orchestration snapshot but must survive
   * project switches.
   */
  projectIds: Iterable<ProjectId>;
  /**
   * Per-project custom-process IDs. Each custom-process terminal tab runs in
   * its own isolated thread (`server:<projectId>:custom:<processId>`); we
   * must retain those too or they disappear when the user switches projects.
   */
  customProcessIdsByProjectId?: ReadonlyMap<ProjectId, ReadonlyArray<string>>;
}

export function collectActiveTerminalThreadIds(
  input: CollectActiveTerminalThreadIdsInput,
): Set<ThreadId> {
  const activeThreadIds = new Set<ThreadId>();
  for (const thread of input.snapshotThreads) {
    if (thread.deletedAt !== null) continue;
    activeThreadIds.add(thread.id);
  }
  for (const draftThreadId of input.draftThreadIds) {
    activeThreadIds.add(draftThreadId);
  }
  // Retain synthetic terminal thread IDs for every known project.
  // The server and git tools create terminal sessions under synthetic IDs
  // (e.g. `server:<projectId>`, `git:<projectId>`) that are never present in
  // the orchestration snapshot. Without explicitly including them here, the
  // orphan-cleanup would delete their terminal state every time a domain
  // event fires — causing running server processes to vanish when the user
  // switches between projects.
  for (const projectId of input.projectIds) {
    activeThreadIds.add(ThreadId.makeUnsafe(`server:${projectId}`));
    activeThreadIds.add(ThreadId.makeUnsafe(`git:${projectId}`));
    // Retain isolated terminal threads for each custom-process tab.
    const customProcessIds = input.customProcessIdsByProjectId?.get(projectId);
    if (customProcessIds) {
      for (const processId of customProcessIds) {
        activeThreadIds.add(ThreadId.makeUnsafe(`server:${projectId}:custom:${processId}`));
      }
    }
  }
  return activeThreadIds;
}
