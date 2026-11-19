import type { Thread } from "~/types";

export interface WorktreeChoice {
  readonly branch: string | null;
  readonly worktreePath: string;
}

/**
 * The worktree the user used most recently in this project that is not the one
 * they are on now, so one shortcut can hop back to where they just were.
 */
export function previousWorktreeChoice(
  threads: ReadonlyArray<
    Pick<
      Thread,
      "projectId" | "environmentId" | "worktreePath" | "branch" | "updatedAt" | "createdAt"
    > & { readonly archivedAt?: string | null }
  >,
  projectId: Thread["projectId"],
  environmentId: Thread["environmentId"],
  currentWorktreePath: string | null,
): WorktreeChoice | null {
  let best: { choice: WorktreeChoice; at: string } | null = null;
  for (const thread of threads) {
    if (thread.projectId !== projectId) continue;
    if ((thread.environmentId ?? null) !== (environmentId ?? null)) continue;
    if (!thread.worktreePath || thread.worktreePath === currentWorktreePath) continue;
    const at = thread.updatedAt ?? thread.createdAt;
    if (!best || at > best.at) {
      best = { choice: { branch: thread.branch, worktreePath: thread.worktreePath }, at };
    }
  }
  return best?.choice ?? null;
}
